import { INestApplication, Module, ServiceUnavailableException } from '@nestjs/common';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';
import { DataSource, In } from 'typeorm';
import { addPipesAndFilters, AppModule } from '../src/app.module';
import { config } from '../src/config';
import { BillingCancellationStatus, OrganizationBillingCancellation } from '../src/entity/organization-billing-cancellation.entity';
import { BILLING_CANCELLATION, BillingCancellation } from '../src/services/organization/billing-cancellation';
import { OrganizationRole, OrganizationStatus } from '../src/domain/organization-actions';
import { OrganizationUser } from '../src/entity/organization-user.entity';
import { Organization } from '../src/entity/organization.entity';
import { ProjectUser } from '../src/entity/project-user.entity';
import { Project } from '../src/entity/project.entity';
import { Term } from '../src/entity/term.entity';
import { User } from '../src/entity/user.entity';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

/**
 * DESIGN §3.9: deleting one's account while others depend on it. `GET /users/me/deletion` says what stands in the way;
 * `DELETE /users/me` takes the choices: a member who becomes admin of a project the person is the last admin of, a
 * member who becomes owner of an organization they own, or the deletion of an organization they are alone in (its slug
 * typed). Without a body it behaves as before.
 */
/** Billing (P4) as the deletion sees it: here a fake, registered the way P4 registers its own. */
const billing: BillingCancellation & {
  calls: Array<{ id: string; status: string; accountGone: boolean }>;
  failing: number;
  dataSource?: DataSource;
} = {
  calls: [],
  failing: 0,
  async cancelForDeletion(organization) {
    const owners = await this.dataSource.getRepository(OrganizationUser).count({ where: { organizationId: organization.id } });
    this.calls.push({ id: organization.id, status: organization.status, accountGone: owners === 0 });
    if (this.failing > 0) {
      this.failing -= 1;
      throw new ServiceUnavailableException('billing is down');
    }
  },
};

@Module({ providers: [{ provide: BILLING_CANCELLATION, useValue: billing }] })
class FakeBillingModule {}

describe('Account deletion with hand-overs (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const saasBefore = config.saasEnabled;

  const server = () => app.getHttpServer();
  const as = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  let seq = 0;

  async function person(prefix: string): Promise<TestingUser> {
    return signupTestUser(app, `${prefix}-${++seq}@test.com`);
  }

  const ownOrganization = async (user: TestingUser) => (await request(server()).get('/api/v1/organizations').set(as(user)).expect(200)).body.data[0];
  const newProject = async (user: TestingUser, organizationId: string, name = 'Shared project') =>
    (await request(server()).post('/api/v1/projects').set(as(user)).send({ name, organizationId }).expect(201)).body.data;
  const invite = (owner: TestingUser, organizationId: string, user: TestingUser, role = 'member') =>
    request(server()).post(`/api/v1/organizations/${organizationId}/invites`).set(as(owner)).send({ email: user.email, role }).expect(201);
  const addToProject = (admin: TestingUser, projectId: string, user: TestingUser, role: string) =>
    request(server()).post(`/api/v1/projects/${projectId}/invites`).set(as(admin)).send({ email: user.email, role }).expect(201);
  const plan = async (user: TestingUser) => (await request(server()).get('/api/v1/users/me/deletion').set(as(user)).expect(200)).body.data;
  const deleteAccount = (user: TestingUser, body?: object) => {
    const req = request(server()).delete('/api/v1/users/me').set(as(user));
    return body ? req.send(body) : req;
  };
  const exists = async (user: TestingUser) => (await dataSource.getRepository(User).count({ where: { id: user.id } })) === 1;

  beforeAll(async () => {
    config.saasEnabled = true;
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule, FakeBillingModule] }).compile();
    app = moduleFixture.createNestApplication<NestExpressApplication>(new ExpressAdapter());
    addPipesAndFilters(app as NestExpressApplication);
    await app.init();
    dataSource = app.get(DataSource);
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    billing.dataSource = dataSource;
  });

  beforeEach(() => {
    billing.calls.length = 0;
    billing.failing = 0;
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    await app.close();
  });

  it('has nothing to decide for an account nobody depends on, and deletes it without a body as before', async () => {
    const alone = await person('alone');
    const organization = await ownOrganization(alone);
    expect(await plan(alone)).toEqual({
      projects: [],
      organizations: [
        { id: organization.id, name: organization.name, slug: organization.slug, status: 'active', projectsCount: 0, onlyMember: true, members: [] },
      ],
    });
    await deleteAccount(alone).expect(204);
    expect(await exists(alone)).toBe(false);
    // Closed with nobody left, its data kept, as before
    expect((await dataSource.getRepository(Organization).findOneBy({ id: organization.id })).status).toBe(OrganizationStatus.Deleted);
  });

  it('hands a project over to the member chosen to be its admin', async () => {
    const owner = await person('owner');
    const organization = await ownOrganization(owner);
    const editor = await person('editor');
    const viewer = await person('viewer');
    await invite(owner, organization.id, editor);
    await invite(owner, organization.id, viewer);
    const project = await newProject(owner, organization.id);
    await addToProject(owner, project.id, editor, 'editor');
    await addToProject(owner, project.id, viewer, 'viewer');
    // The organization needs a new owner too: the editor
    const decided = await plan(owner);
    expect(decided.projects).toEqual([
      {
        id: project.id,
        name: 'Shared project',
        organizationId: organization.id,
        members: expect.arrayContaining([
          { userId: editor.id, name: editor.name, email: editor.email, role: 'editor' },
          { userId: viewer.id, name: viewer.name, email: viewer.email, role: 'viewer' },
        ]),
      },
    ]);
    expect(decided.organizations).toEqual([expect.objectContaining({ id: organization.id, onlyMember: false, projectsCount: 1 })]);
    expect(decided.organizations[0].members.map(m => m.userId).sort((x, y) => x.localeCompare(y))).toEqual(
      [editor.id, viewer.id].sort((x, y) => x.localeCompare(y)),
    );

    // As before without a choice: refused, nothing changed
    await deleteAccount(owner).expect(422);
    expect(await exists(owner)).toBe(true);

    // Someone who is not in the project cannot take it over
    const stranger = await person('stranger');
    const refused = await deleteAccount(owner, {
      projectAdmins: [{ projectId: project.id, userId: stranger.id }],
      organizationOwners: [{ organizationId: organization.id, userId: editor.id }],
    }).expect(400);
    expect(refused.body.error.code).toBe('transfer_invalid');
    expect(await exists(owner)).toBe(true);

    // A project choice alone leaves the organization without its owner
    const owned = await deleteAccount(owner, { projectAdmins: [{ projectId: project.id, userId: viewer.id }] }).expect(422);
    expect(owned.body.error.code).toBe('owner_required');
    const viewerRole = await dataSource.getRepository(ProjectUser).findOne({ where: { project: { id: project.id }, user: { id: viewer.id } } });
    expect(viewerRole.role).toBe('viewer');

    await deleteAccount(owner, {
      projectAdmins: [{ projectId: project.id, userId: editor.id }],
      organizationOwners: [{ organizationId: organization.id, userId: editor.id }],
    }).expect(204);
    expect(await exists(owner)).toBe(false);
    const roles = await dataSource.getRepository(ProjectUser).find({ where: { project: { id: project.id } }, relations: ['user'] });
    expect(roles.map(m => `${m.user.id}:${m.role}`).sort((x, y) => x.localeCompare(y))).toEqual(
      [`${editor.id}:admin`, `${viewer.id}:viewer`].sort((x, y) => x.localeCompare(y)),
    );
    const members = await dataSource.getRepository(OrganizationUser).find({ where: { organizationId: organization.id } });
    expect(members.map(m => `${m.userId}:${m.role}`).sort((x, y) => x.localeCompare(y))).toEqual(
      [`${editor.id}:owner`, `${viewer.id}:member`].sort((x, y) => x.localeCompare(y)),
    );
    await request(server()).get(`/api/v1/projects/${project.id}/terms`).set(as(editor)).expect(200);
    await request(server()).get(`/api/v1/organizations/${organization.id}/members`).set(as(editor)).expect(200);
  });

  it('refuses to hand over what is not the account’s own', async () => {
    const owner = await person('owner');
    const organization = await ownOrganization(owner);
    const other = await person('other');
    const otherOrganization = await ownOrganization(other);
    const otherProject = await newProject(other, otherOrganization.id, 'Not yours');
    for (const body of [
      { organizationOwners: [{ organizationId: otherOrganization.id, userId: owner.id }] },
      { projectAdmins: [{ projectId: otherProject.id, userId: owner.id }] },
      { deleteOrganizations: [{ organizationId: otherOrganization.id, slug: otherOrganization.slug }] },
      // Its own organization has nobody to hand it to
      { organizationOwners: [{ organizationId: organization.id, userId: other.id }] },
    ]) {
      const res = await deleteAccount(owner, body).expect(400);
      expect(res.body.error.code).toBe('transfer_invalid');
    }
    for (const body of [
      { projectAdmins: 'all' },
      { deleteOrganizations: [{ organizationId: organization.id }] },
      { organizationOwners: [{}] },
      // Lists are omitted, never null
      { projectAdmins: null },
      { organizationOwners: null },
      { deleteOrganizations: null },
      // Ids are uuids
      { projectAdmins: [{ projectId: 'not-a-uuid', userId: other.id }] },
      { deleteOrganizations: [{ organizationId: 'not-a-uuid', slug: organization.slug }] },
      { organizationOwners: [{ organizationId: organization.id, userId: '1' }] },
    ]) {
      const res = await deleteAccount(owner, body);
      expect([JSON.stringify(body), res.status]).toEqual([JSON.stringify(body), 400]);
    }
    expect(await exists(owner)).toBe(true);
    expect((await dataSource.getRepository(Organization).findOneBy({ id: otherOrganization.id })).status).toBe(OrganizationStatus.Active);
    expect(await dataSource.getRepository(Project).count({ where: { id: otherProject.id } })).toBe(1);
  });

  it('deletes an organization the person is alone in with the account, once its slug is typed, and nothing else', async () => {
    const owner = await person('solo');
    const organization = await ownOrganization(owner);
    const projects = [await newProject(owner, organization.id, 'First'), await newProject(owner, organization.id, 'Second')];
    await request(server()).post(`/api/v1/projects/${projects[0].id}/terms`).set(as(owner)).send({ value: 'solo.term' }).expect(201);
    const bystander = await person('bystander');
    const bystanderOrganization = await ownOrganization(bystander);
    const bystanderProject = await newProject(bystander, bystanderOrganization.id, 'Untouched');

    const decided = await plan(owner);
    expect(decided.organizations).toEqual([expect.objectContaining({ id: organization.id, onlyMember: true, projectsCount: 2, members: [] })]);

    const mismatch = await deleteAccount(owner, { deleteOrganizations: [{ organizationId: organization.id, slug: 'wrong-slug' }] }).expect(400);
    expect(mismatch.body.error.code).toBe('slug_mismatch');
    expect(await exists(owner)).toBe(true);

    expect(billing.calls).toEqual([]);
    await deleteAccount(owner, { deleteOrganizations: [{ organizationId: organization.id, slug: organization.slug }] }).expect(204);
    expect(await exists(owner)).toBe(false);
    // Cancelled once, after the commit: the organization a tombstone, the account gone
    expect(billing.calls).toEqual([{ id: organization.id, status: OrganizationStatus.Deleted, accountGone: true }]);
    expect(await dataSource.getRepository(Project).count({ where: { id: In(projects.map(p => p.id)) } })).toBe(0);
    expect(await dataSource.getRepository(Term).count({ where: { value: 'solo.term' } })).toBe(0);
    expect(await dataSource.getRepository(Organization).findOneBy({ id: organization.id })).toMatchObject({ status: OrganizationStatus.Deleted });

    expect(await dataSource.getRepository(Project).count({ where: { id: bystanderProject.id } })).toBe(1);
    expect((await dataSource.getRepository(Organization).findOneBy({ id: bystanderOrganization.id })).status).toBe(OrganizationStatus.Active);
    await request(server()).get(`/api/v1/projects/${bystanderProject.id}`).set(as(bystander)).expect(200);
  });

  it('cancels nothing when the deletion is refused after the choice: a hand-over, a last admin, an owner', async () => {
    const owner = await person('refused');
    const organization = await ownOrganization(owner);
    const other = await person('other-org');
    const otherOrganization = await ownOrganization(other);
    const elsewhere = await newProject(other, otherOrganization.id, 'Elsewhere');
    await invite(other, otherOrganization.id, owner);
    await request(server()).post(`/api/v1/projects/${elsewhere.id}/invites`).set(as(other)).send({ email: owner.email, role: 'admin' }).expect(201);
    const sole = { deleteOrganizations: [{ organizationId: organization.id, slug: organization.slug }] };

    // A hand-over to someone who is not in the project
    const stranger = await person('stranger');
    const handOver = await deleteAccount(owner, { ...sole, projectAdmins: [{ projectId: elsewhere.id, userId: stranger.id }] }).expect(400);
    expect(handOver.body.error.code).toBe('transfer_invalid');
    // A new owner for an organization the person does not own
    const notOwned = await deleteAccount(owner, { ...sole, organizationOwners: [{ organizationId: otherOrganization.id, userId: other.id }] }).expect(
      400,
    );
    expect(notOwned.body.error.code).toBe('transfer_invalid');

    // The last admin of a project another one uses, in the other organization
    await request(server()).patch(`/api/v1/projects/${elsewhere.id}/users/${other.id}`).set(as(owner)).send({ role: 'viewer' }).expect(200);
    const lastAdmin = await deleteAccount(owner, sole).expect(422);
    expect(lastAdmin.body.error.code).toBe('UnprocessableEntity');

    expect(billing.calls).toEqual([]);
    expect(await dataSource.getRepository(OrganizationBillingCancellation).count({ where: { organizationId: organization.id } })).toBe(0);
    expect(await exists(owner)).toBe(true);
    expect((await dataSource.getRepository(Organization).findOneBy({ id: organization.id })).status).toBe(OrganizationStatus.Active);
    expect(await dataSource.getRepository(Project).count({ where: { id: elsewhere.id } })).toBe(1);
  });

  it('deletes the account and the organization when billing fails, and leaves the cancellation to an operator', async () => {
    const owner = await person('billing-down');
    const organization = await ownOrganization(owner);
    billing.failing = 3;
    await deleteAccount(owner, { deleteOrganizations: [{ organizationId: organization.id, slug: organization.slug }] }).expect(204);
    expect(await exists(owner)).toBe(false);
    expect(billing.calls).toHaveLength(3);
    expect(await dataSource.getRepository(OrganizationBillingCancellation).findOneBy({ organizationId: organization.id })).toMatchObject({
      status: BillingCancellationStatus.Failed,
      attempts: 3,
    });
  });

  it('keeps what an operator decided: no deletion of the owner or the last member of a suspended organization', async () => {
    const owner = await person('suspended-owner');
    const organization = await ownOrganization(owner);
    const colleague = await person('suspended-colleague');
    const member = await person('suspended-member');
    await invite(owner, organization.id, colleague);
    await invite(owner, organization.id, member);
    await dataSource.getRepository(Organization).update({ id: organization.id }, { status: OrganizationStatus.Suspended });
    try {
      expect((await plan(owner)).organizations).toEqual([expect.objectContaining({ id: organization.id, status: 'suspended', onlyMember: false })]);
      for (const body of [undefined, { organizationOwners: [{ organizationId: organization.id, userId: colleague.id }] }]) {
        const res = await deleteAccount(owner, body).expect(403);
        expect(res.body.error.code).toBe('organization_suspended');
      }
      // A member leaves it as usual
      await deleteAccount(member).expect(204);
      const members = await dataSource.getRepository(OrganizationUser).find({ where: { organizationId: organization.id } });
      expect(members.map(m => `${m.userId}:${m.role}`).sort((x, y) => x.localeCompare(y))).toEqual(
        [`${owner.id}:owner`, `${colleague.id}:member`].sort((x, y) => x.localeCompare(y)),
      );
      expect((await dataSource.getRepository(Organization).findOneBy({ id: organization.id })).status).toBe(OrganizationStatus.Suspended);
    } finally {
      await dataSource.getRepository(Organization).update({ id: organization.id }, { status: OrganizationStatus.Active });
    }
  });

  it('refuses to delete an organization with other members, or a suspended one, with the account', async () => {
    const owner = await person('owner');
    const organization = await ownOrganization(owner);
    const colleague = await person('colleague');
    await invite(owner, organization.id, colleague);
    const withOthers = await deleteAccount(owner, { deleteOrganizations: [{ organizationId: organization.id, slug: organization.slug }] }).expect(
      400,
    );
    expect(withOthers.body.error.code).toBe('transfer_invalid');

    const solo = await person('suspended');
    const soloOrganization = await ownOrganization(solo);
    await dataSource.getRepository(Organization).update({ id: soloOrganization.id }, { status: OrganizationStatus.Suspended });
    const suspended = await deleteAccount(solo, {
      deleteOrganizations: [{ organizationId: soloOrganization.id, slug: soloOrganization.slug }],
    }).expect(403);
    expect(suspended.body.error.code).toBe('organization_suspended');
    // Without a choice too: the account would close it, which the operator did not decide
    expect((await deleteAccount(solo).expect(403)).body.error.code).toBe('organization_suspended');
    expect(await exists(owner)).toBe(true);
    expect(await exists(solo)).toBe(true);
    expect((await dataSource.getRepository(Organization).findOneBy({ id: soloOrganization.id })).status).toBe(OrganizationStatus.Suspended);
  });

  it('answers only the person, never an API key', async () => {
    const owner = await person('keys');
    const organization = await ownOrganization(owner);
    const project = await newProject(owner, organization.id);
    const client = (
      await request(server()).post(`/api/v1/projects/${project.id}/clients`).set(as(owner)).send({ name: 'ci', role: 'admin' }).expect(201)
    ).body.data;
    const token = (
      await request(server())
        .post('/api/v1/auth/token')
        .send({ grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret })
        .expect(200)
    ).body.access_token;
    await request(server())
      .get('/api/v1/users/me/deletion')
      .set({ Authorization: `Bearer ${token}` })
      .expect(401);
    await request(server())
      .delete('/api/v1/users/me')
      .set({ Authorization: `Bearer ${token}` })
      .expect(401);
    await request(server()).get('/api/v1/users/me/deletion').expect(401);
  });
});

describe('Account deletion with hand-overs on a single-tenant install (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const saasBefore = config.saasEnabled;
  const server = () => app.getHttpServer();
  const as = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });

  beforeAll(async () => {
    config.saasEnabled = false;
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    await app.close();
  });

  it('lists no organization, hands a project over, and passes the default organization on by itself', async () => {
    const first = await signupTestUser(app, 'first-single@test.com');
    const second = await signupTestUser(app, 'second-single@test.com');
    const project = (await request(server()).post('/api/v1/projects').set(as(first)).send({ name: 'Shared' }).expect(201)).body.data;
    await request(server()).post(`/api/v1/projects/${project.id}/invites`).set(as(first)).send({ email: second.email, role: 'editor' }).expect(201);

    const decided = (await request(server()).get('/api/v1/users/me/deletion').set(as(first)).expect(200)).body.data;
    expect(decided.organizations).toEqual([]);
    expect(decided.projects.map(p => [p.id, p.members.map(m => m.userId)])).toEqual([[project.id, [second.id]]]);

    await request(server()).delete('/api/v1/users/me').set(as(first)).expect(422);
    await request(server())
      .delete('/api/v1/users/me')
      .set(as(first))
      .send({ projectAdmins: [{ projectId: project.id, userId: second.id }] })
      .expect(204);
    const roles = await dataSource.getRepository(ProjectUser).find({ where: { project: { id: project.id } }, relations: ['user'] });
    expect(roles.map(m => `${m.user.id}:${m.role}`)).toEqual([`${second.id}:admin`]);
    const fallback = await dataSource.getRepository(Organization).findOneBy({ isDefault: true });
    const owner = await dataSource.getRepository(OrganizationUser).findOneBy({ organizationId: fallback.id, role: OrganizationRole.Owner });
    expect(owner.userId).toBe(second.id);
  });
});
