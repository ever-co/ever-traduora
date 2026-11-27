import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { config } from '../src/config';
import { OrganizationRole, OrganizationStatus } from '../src/domain/organization-actions';
import { OrganizationUser } from '../src/entity/organization-user.entity';
import { Organization } from '../src/entity/organization.entity';
import { ProjectUser } from '../src/entity/project-user.entity';
import { Project } from '../src/entity/project.entity';
import { OrganizationInvite } from '../src/entity/organization-invite.entity';
import { User } from '../src/entity/user.entity';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

/** Sorts strings, or pairs of strings, by their text. */
const byText = (left: unknown, right: unknown) => String(left).localeCompare(String(right));

interface Org {
  id: string;
  name: string;
  slug: string;
  role: string;
}

const ORGANIZATION_PROPERTIES = ['id', 'name', 'slug', 'status', 'planCode', 'isDefault', 'adminsSeeAllProjects', 'role', 'date'];

describe('Organizations in SaaS mode (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const saasBefore = config.saasEnabled;

  const server = () => app.getHttpServer();
  const auth = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const organizationsOf = async (user: TestingUser): Promise<Org[]> =>
    (await request(server()).get('/api/v1/organizations').set(auth(user)).expect(200)).body.data;
  const onlyOrganizationOf = async (user: TestingUser): Promise<Org> => {
    const organizations = await organizationsOf(user);
    expect(organizations).toHaveLength(1);
    return organizations[0];
  };
  const createProject = async (user: TestingUser, organizationId?: string) =>
    (
      await request(server())
        .post('/api/v1/projects')
        .set(auth(user))
        .send({ name: 'A project', ...(organizationId ? { organizationId } : {}) })
        .expect(201)
    ).body.data;
  const projectIds = async (user: TestingUser, organizationId?: string): Promise<string[]> =>
    (
      await request(server())
        .get('/api/v1/projects')
        .query(organizationId ? { organizationId } : {})
        .set(auth(user))
        .expect(200)
    ).body.data
      .map(project => project.id)
      .sort(byText);
  const addToProject = (admin: TestingUser, projectId: string, user: TestingUser, role: string) =>
    request(server()).post(`/api/v1/projects/${projectId}/invites`).set(auth(admin)).send({ email: user.email, role }).expect(201);
  const inviteToOrganization = (admin: TestingUser, organizationId: string, email: string, role = 'member') =>
    request(server()).post(`/api/v1/organizations/${organizationId}/invites`).set(auth(admin)).send({ email, role });

  beforeAll(async () => {
    config.saasEnabled = true;
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    await app.close();
  });

  describe('sign-up and creation', () => {
    it('gives a new person their own organization, as its owner on the Starter plan', async () => {
      const alice = await signupTestUser(app, 'alice-own@test.com');
      const organization = await onlyOrganizationOf(alice);
      expect(organization).toHaveExactProperties(ORGANIZATION_PROPERTIES);
      expect(organization).toMatchObject({
        name: `${alice.name}'s organization`,
        role: 'owner',
        planCode: 'starter',
        status: 'active',
        isDefault: false,
        adminsSeeAllProjects: true,
      });
      expect(organization.slug).toMatch(/^[a-z0-9-]{3,40}$/);
    });

    it('names the organization as the sign-up asks', async () => {
      const res = await request(server())
        .post('/api/v1/auth/signup')
        .send({ name: 'Zed', email: 'zed@test.com', password: 'mysupersecretpassword', organizationName: 'Zed Translations' })
        .expect(200);
      const zed = res.body.data as TestingUser;
      const organization = await onlyOrganizationOf(zed);
      expect(organization).toMatchObject({ name: 'Zed Translations', slug: 'zed-translations', role: 'owner' });
    });

    it('creates more organizations, and refuses a reserved, malformed or taken slug', async () => {
      const owner = await signupTestUser(app, 'creator@test.com');
      const created = await request(server()).post('/api/v1/organizations').set(auth(owner)).send({ name: 'Beta Co', slug: 'beta-co' }).expect(201);
      expect(created.body.data).toHaveExactProperties(ORGANIZATION_PROPERTIES);
      expect(created.body.data).toMatchObject({ name: 'Beta Co', slug: 'beta-co', role: 'owner', planCode: 'starter' });
      expect(await organizationsOf(owner)).toHaveLength(2);

      for (const slug of ['admin', 'default', 'a--b', '-abc', 'abc-', 'ab', 'a_b_c']) {
        const res = await request(server()).post('/api/v1/organizations').set(auth(owner)).send({ name: 'Nope', slug });
        expect([slug, res.status]).toEqual([slug, 400]);
      }
      const taken = await request(server()).post('/api/v1/organizations').set(auth(owner)).send({ name: 'Beta', slug: 'beta-co' }).expect(409);
      expect(taken.body.error.code).toBe('slug_taken');

      // Without a slug: derived from the name, with a suffix when taken
      const derived = await request(server()).post('/api/v1/organizations').set(auth(owner)).send({ name: 'Beta Co' }).expect(201);
      expect(derived.body.data.slug).toMatch(/^beta-co-[0-9a-f]{6}$/);
    });

    it('renames an organization (owner, admin) and refuses a member', async () => {
      const owner = await signupTestUser(app, 'renamer@test.com');
      const member = await signupTestUser(app, 'renamed-member@test.com');
      const organization = await onlyOrganizationOf(owner);
      await inviteToOrganization(owner, organization.id, member.email).expect(201);

      const res = await request(server())
        .patch(`/api/v1/organizations/${organization.id}`)
        .set(auth(owner))
        .send({ name: 'Renamed', slug: 'renamed-org' })
        .expect(200);
      expect(res.body.data).toMatchObject({ name: 'Renamed', slug: 'renamed-org', role: 'owner' });
      await request(server()).patch(`/api/v1/organizations/${organization.id}`).set(auth(member)).send({ name: 'Mine now' }).expect(404);
      const reserved = await request(server())
        .patch(`/api/v1/organizations/${organization.id}`)
        .set(auth(owner))
        .send({ slug: 'billing' })
        .expect(400);
      expect(reserved.body.error.code).toBe('slug_invalid');
      await request(server()).get(`/api/v1/organizations/${organization.id}`).set(auth(member)).expect(200);
    });
  });

  describe('members and invites', () => {
    let owner: TestingUser;
    let organization: Org;

    beforeAll(async () => {
      owner = await signupTestUser(app, 'members-owner@test.com');
      organization = await onlyOrganizationOf(owner);
    });

    it('adds an account with a verified email at once, and invites anyone else with a link', async () => {
      const verified = await signupTestUser(app, 'verified@test.com');
      const added = await inviteToOrganization(owner, organization.id, verified.email, 'admin').expect(201);
      expect(added.body.data).toEqual({ userId: verified.id, name: verified.name, email: verified.email, role: 'admin' });
      expect((await organizationsOf(verified)).map(o => [o.id, o.role])).toContainEqual([organization.id, 'admin']);
      await inviteToOrganization(owner, organization.id, verified.email).expect(409);

      const invited = await inviteToOrganization(owner, organization.id, 'Newcomer@Test.com').expect(201);
      expect(invited.body.data).toHaveExactProperties(['id', 'email', 'role', 'status', 'inviteUrl']);
      expect(invited.body.data).toMatchObject({ email: 'Newcomer@test.com', role: 'member', status: 'sent' });
      const invites = await request(server()).get(`/api/v1/organizations/${organization.id}/invites`).set(auth(owner)).expect(200);
      expect(invites.body.data.map(i => i.email)).toEqual(['Newcomer@test.com']);

      // The link's token signs the invitee up into this organization, and gives them no organization of their own
      const token = new URL(invited.body.data.inviteUrl).searchParams.get('invite');
      const signup = await request(server())
        .post('/api/v1/auth/signup')
        .send({ name: 'Newcomer', email: 'Newcomer@test.com', password: 'mysupersecretpassword', inviteToken: token })
        .expect(200);
      const newcomer = signup.body.data as TestingUser;
      expect((await organizationsOf(newcomer)).map(o => [o.id, o.role])).toEqual([[organization.id, 'member']]);
      const after = await request(server()).get(`/api/v1/organizations/${organization.id}/invites`).set(auth(owner)).expect(200);
      expect(after.body.data).toEqual([]);
    });

    it('needs the invite token to sign up with an invited email', async () => {
      await inviteToOrganization(owner, organization.id, 'tokenless@test.com').expect(201);
      await request(server())
        .post('/api/v1/auth/signup')
        .send({ name: 'Tokenless', email: 'tokenless@test.com', password: 'mysupersecretpassword' })
        .expect(401);
    });

    it('lets an existing account accept with the link, only for the email it was sent to', async () => {
      const existing = await signupTestUser(app, 'existing@test.com', false);
      const other = await signupTestUser(app, 'other@test.com');
      const invited = await inviteToOrganization(owner, organization.id, existing.email).expect(201);
      const token = new URL(invited.body.data.inviteUrl).searchParams.get('invite');

      await request(server()).post('/api/v1/auth/accept-organization-invite').set(auth(other)).send({ inviteToken: token }).expect(404);
      const accepted = await request(server())
        .post('/api/v1/auth/accept-organization-invite')
        .set(auth(existing))
        .send({ inviteToken: token })
        .expect(200);
      expect(accepted.body.data).toEqual({ organizationId: organization.id, slug: organization.slug, role: 'member' });
      // Used once
      await request(server()).post('/api/v1/auth/accept-organization-invite').set(auth(existing)).send({ inviteToken: token }).expect(404);
    });

    it('revokes an invite, so its link stops working', async () => {
      const invited = await inviteToOrganization(owner, organization.id, 'revoked@test.com').expect(201);
      await request(server()).delete(`/api/v1/organizations/${organization.id}/invites/${invited.body.data.id}`).set(auth(owner)).expect(204);
      const token = new URL(invited.body.data.inviteUrl).searchParams.get('invite');
      await request(server())
        .post('/api/v1/auth/signup')
        .send({ name: 'Revoked', email: 'revoked@test.com', password: 'mysupersecretpassword', inviteToken: token })
        .expect(200);
      const revoked = (
        await request(server())
          .post('/api/v1/auth/token')
          .send({ grant_type: 'password', username: 'revoked@test.com', password: 'mysupersecretpassword' })
      ).body;
      const theirs = await organizationsOf({ accessToken: revoked.access_token } as TestingUser);
      expect(theirs.map(o => o.id)).not.toContain(organization.id);
    });

    it('changes roles and removes members, but never the owner', async () => {
      const admin = await signupTestUser(app, 'roles-admin@test.com');
      const member = await signupTestUser(app, 'roles-member@test.com');
      await inviteToOrganization(owner, organization.id, admin.email, 'member').expect(201);
      await inviteToOrganization(owner, organization.id, member.email, 'member').expect(201);
      const members = (await request(server()).get(`/api/v1/organizations/${organization.id}/members`).set(auth(member)).expect(200)).body.data;
      expect(members[0]).toHaveExactProperties(['userId', 'name', 'email', 'role']);

      const promoted = await request(server())
        .patch(`/api/v1/organizations/${organization.id}/members/${admin.id}`)
        .set(auth(owner))
        .send({ role: 'admin' })
        .expect(200);
      expect(promoted.body.data.role).toBe('admin');

      // A member may not change anyone; an admin may not change the owner, nor make an owner, nor change themselves
      await request(server())
        .patch(`/api/v1/organizations/${organization.id}/members/${admin.id}`)
        .set(auth(member))
        .send({ role: 'member' })
        .expect(404);
      const ownerRole = await request(server())
        .patch(`/api/v1/organizations/${organization.id}/members/${owner.id}`)
        .set(auth(admin))
        .send({ role: 'member' })
        .expect(400);
      expect(ownerRole.body.error.code).toBe('owner_role');
      await request(server())
        .patch(`/api/v1/organizations/${organization.id}/members/${member.id}`)
        .set(auth(admin))
        .send({ role: 'owner' })
        .expect(400);
      await request(server())
        .patch(`/api/v1/organizations/${organization.id}/members/${admin.id}`)
        .set(auth(admin))
        .send({ role: 'member' })
        .expect(400);

      const removeOwner = await request(server()).delete(`/api/v1/organizations/${organization.id}/members/${owner.id}`).set(auth(admin)).expect(400);
      expect(removeOwner.body.error.code).toBe('owner_required');
      const leaveOwner = await request(server()).delete(`/api/v1/organizations/${organization.id}/members/${owner.id}`).set(auth(owner)).expect(400);
      expect(leaveOwner.body.error.code).toBe('owner_required');
      await request(server()).delete(`/api/v1/organizations/${organization.id}/members/${admin.id}`).set(auth(member)).expect(404);

      // Removing a member also ends their project memberships in the organization's projects, and only there
      const project = await createProject(owner, organization.id);
      const secondProject = await createProject(owner, organization.id);
      await addToProject(owner, project.id, member, 'editor');
      await addToProject(owner, secondProject.id, member, 'viewer');
      const elsewhere = await createProject(member); // in the member's own organization
      const memberships = async () =>
        (await dataSource.getRepository(ProjectUser).find({ where: { user: { id: member.id } }, relations: ['project'] }))
          .map(row => row.project.id)
          .sort(byText);
      expect(await memberships()).toEqual([project.id, secondProject.id, elsewhere.id].sort(byText));
      await request(server()).get(`/api/v1/projects/${project.id}`).set(auth(member)).expect(200);
      await request(server()).delete(`/api/v1/organizations/${organization.id}/members/${member.id}`).set(auth(admin)).expect(204);
      await request(server()).get(`/api/v1/projects/${project.id}`).set(auth(member)).expect(404);
      expect(await memberships()).toEqual([elsewhere.id]);
      // The other members keep theirs
      expect(await dataSource.getRepository(ProjectUser).count({ where: { project: { id: project.id } } })).toBe(1);

      // A member leaves by removing themselves
      await request(server()).delete(`/api/v1/organizations/${organization.id}/members/${admin.id}`).set(auth(admin)).expect(204);
      expect((await organizationsOf(admin)).map(o => o.id)).not.toContain(organization.id);
    });

    it('lists and changes no members of the default organization, in SaaS mode either', async () => {
      // An upgraded install: the default organization holds every migrated account
      const legacy = await signupTestUser(app, 'legacy-owner@test.com');
      const other = await signupTestUser(app, 'legacy-member@test.com');
      const defaultOrganization = await dataSource.getRepository(Organization).findOneByOrFail({ isDefault: true });
      await dataSource.getRepository(OrganizationUser).save([
        { organizationId: defaultOrganization.id, userId: legacy.id, role: OrganizationRole.Owner },
        { organizationId: defaultOrganization.id, userId: other.id, role: OrganizationRole.Member },
      ]);
      const base = `/api/v1/organizations/${defaultOrganization.id}`;
      await request(server()).get(base).set(auth(other)).expect(200);
      for (const [method, path, body] of [
        ['get', `${base}/members`, {}],
        ['patch', `${base}/members/${other.id}`, { role: 'admin' }],
        ['delete', `${base}/members/${other.id}`, {}],
        ['get', `${base}/invites`, {}],
        ['post', `${base}/invites`, { email: 'x@test.com', role: 'member' }],
        ['post', `${base}/transfer-ownership`, { userId: other.id }],
      ] as Array<[string, string, object]>) {
        const res = await request(server())[method](path).set(auth(legacy)).send(body);
        expect([method, path, res.status, res.body.error?.code]).toEqual([method, path, 404, 'saas_disabled']);
      }
      // A member leaving it is refused the same way
      const leave = await request(server()).delete(`${base}/members/${other.id}`).set(auth(other));
      expect([leave.status, leave.body.error?.code]).toEqual([404, 'saas_disabled']);
      // A non-member still learns nothing
      const stranger = await signupTestUser(app, 'legacy-stranger@test.com');
      const hidden = await request(server()).get(`${base}/members`).set(auth(stranger));
      expect([hidden.status, hidden.body.error?.code]).toEqual([404, 'NotFound']);
    });

    it('keeps the seat counter: members plus pending invites', async () => {
      // Its own pending invite, so the count holds without the tests before
      await inviteToOrganization(owner, organization.id, 'seat-counter-pending@test.com').expect(201);
      const members = await dataSource.getRepository(OrganizationUser).count({ where: { organizationId: organization.id } });
      const pending = (await request(server()).get(`/api/v1/organizations/${organization.id}/invites`).set(auth(owner)).expect(200)).body.data.length;
      expect(pending).toBeGreaterThan(0);
      const stored = await dataSource.getRepository(Organization).findOneByOrFail({ id: organization.id });
      expect(stored.seatsUsed).toBe(members + pending);
    });
  });

  describe('ownership', () => {
    it('transfers the ownership to a member; the previous owner becomes an admin', async () => {
      const owner = await signupTestUser(app, 'transfer-owner@test.com');
      const next = await signupTestUser(app, 'transfer-next@test.com');
      const organization = await onlyOrganizationOf(owner);
      await inviteToOrganization(owner, organization.id, next.email).expect(201);

      await request(server())
        .post(`/api/v1/organizations/${organization.id}/transfer-ownership`)
        .set(auth(next))
        .send({ userId: next.id })
        .expect(404);
      const res = await request(server())
        .post(`/api/v1/organizations/${organization.id}/transfer-ownership`)
        .set(auth(owner))
        .send({ userId: next.id })
        .expect(200);
      const roles = Object.fromEntries(res.body.data.map(member => [member.userId, member.role]));
      expect(roles).toEqual({ [owner.id]: 'admin', [next.id]: 'owner' });
      const owners = await dataSource
        .getRepository(OrganizationUser)
        .count({ where: { organizationId: organization.id, role: OrganizationRole.Owner } });
      expect(owners).toBe(1);
      // The former owner, now an admin, cannot transfer it back
      await request(server())
        .post(`/api/v1/organizations/${organization.id}/transfer-ownership`)
        .set(auth(owner))
        .send({ userId: owner.id })
        .expect(404);
    });

    it('refuses to delete the account of an owner whose organization has other members', async () => {
      const owner = await signupTestUser(app, 'deleting-owner@test.com');
      const member = await signupTestUser(app, 'deleting-member@test.com');
      const organization = await onlyOrganizationOf(owner);
      await inviteToOrganization(owner, organization.id, member.email).expect(201);
      const res = await request(server()).delete('/api/v1/users/me').set(auth(owner)).expect(422);
      expect(res.body.error.code).toBe('owner_required');
      // A sole member can go
      await request(server()).delete('/api/v1/users/me').set(auth(member)).expect(204);
      expect(await dataSource.getRepository(User).count({ where: { id: member.id } })).toBe(0);
    });

    it('closes an organization whose last member deletes their account, and its invites stop working', async () => {
      const owner = await signupTestUser(app, 'closing-owner@test.com');
      const organization = await onlyOrganizationOf(owner);
      const project = await createProject(owner, organization.id);
      const invited = await inviteToOrganization(owner, organization.id, 'closing-invitee@test.com').expect(201);
      const token = new URL(invited.body.data.inviteUrl).searchParams.get('invite');

      await request(server()).delete('/api/v1/users/me').set(auth(owner)).expect(204);
      const stored = await dataSource.getRepository(Organization).findOneByOrFail({ id: organization.id });
      expect(stored.status).toBe(OrganizationStatus.Deleted);
      expect(stored.seatsUsed).toBe(0);
      // Its data stays (deletion proper is P6); its pending invites are gone
      expect(await dataSource.getRepository(Project).count({ where: { id: project.id } })).toBe(1);
      expect(await dataSource.getRepository(OrganizationInvite).count({ where: { organizationId: organization.id } })).toBe(0);

      // The invitee signs up on their own (no pending invite holds them back) and the old link joins nothing
      const signup = await request(server())
        .post('/api/v1/auth/signup')
        .send({ name: 'Late Invitee', email: 'closing-invitee@test.com', password: 'mysupersecretpassword', inviteToken: token })
        .expect(200);
      const invitee = signup.body.data as TestingUser;
      await request(server()).post('/api/v1/auth/accept-organization-invite').set(auth(invitee)).send({ inviteToken: token }).expect(404);
      expect((await organizationsOf(invitee)).map(o => o.id)).not.toContain(organization.id);
    });

    it('recounts the seats when a member deletes their account', async () => {
      const owner = await signupTestUser(app, 'seats-owner@test.com');
      const member = await signupTestUser(app, 'seats-member@test.com');
      const organization = await onlyOrganizationOf(owner);
      await inviteToOrganization(owner, organization.id, member.email).expect(201);
      const seats = async () => (await dataSource.getRepository(Organization).findOneByOrFail({ id: organization.id })).seatsUsed;
      expect(await seats()).toBe(2);
      await request(server()).delete('/api/v1/users/me').set(auth(member)).expect(204);
      expect(await seats()).toBe(1);
    });

    it('grants the role of an organization invite accepted after a project invite made the person a member', async () => {
      const owner = await signupTestUser(app, 'ranks-owner@test.com');
      const person = await signupTestUser(app, 'ranks-person@test.com', false);
      const organization = await onlyOrganizationOf(owner);
      const project = await createProject(owner, organization.id);
      const projectInvite = await request(server())
        .post(`/api/v1/projects/${project.id}/invites`)
        .set(auth(owner))
        .send({ email: person.email, role: 'editor' })
        .expect(201);
      const organizationInvite = await inviteToOrganization(owner, organization.id, person.email, 'admin').expect(201);
      const tokenOf = (res: request.Response) => new URL(res.body.data.inviteUrl).searchParams.get('invite');

      // The project invite first: the person joins as a member
      await request(server())
        .post('/api/v1/auth/accept-invite')
        .set(auth(person))
        .send({ inviteToken: tokenOf(projectInvite) })
        .expect(200);
      expect((await organizationsOf(person)).find(o => o.id === organization.id)?.role).toBe('member');
      // Then the organization invite: its admin role applies, and is the role answered
      const accepted = await request(server())
        .post('/api/v1/auth/accept-organization-invite')
        .set(auth(person))
        .send({ inviteToken: tokenOf(organizationInvite) })
        .expect(200);
      expect(accepted.body.data.role).toBe('admin');
      expect((await organizationsOf(person)).find(o => o.id === organization.id)?.role).toBe('admin');
    });

    it('accepts no invite of an organization that is not active', async () => {
      const owner = await signupTestUser(app, 'suspended-inviter@test.com');
      const invitee = await signupTestUser(app, 'suspended-invitee@test.com', false);
      const organization = await onlyOrganizationOf(owner);
      const invited = await inviteToOrganization(owner, organization.id, invitee.email).expect(201);
      const token = new URL(invited.body.data.inviteUrl).searchParams.get('invite');
      await dataSource.getRepository(Organization).update({ id: organization.id }, { status: OrganizationStatus.Suspended });
      await request(server()).post('/api/v1/auth/accept-organization-invite').set(auth(invitee)).send({ inviteToken: token }).expect(404);
      await dataSource.getRepository(Organization).update({ id: organization.id }, { status: OrganizationStatus.Active });
      await request(server()).post('/api/v1/auth/accept-organization-invite').set(auth(invitee)).send({ inviteToken: token }).expect(200);
    });
  });

  describe('projects', () => {
    it('shows a person in two organizations the projects of each one only where they are a member', async () => {
      const alice = await signupTestUser(app, 'two-alice@test.com');
      const frank = await signupTestUser(app, 'two-frank@test.com');
      const erin = await signupTestUser(app, 'two-erin@test.com');
      const a = await onlyOrganizationOf(alice);
      const f = await onlyOrganizationOf(frank);
      const e = await onlyOrganizationOf(erin);
      await inviteToOrganization(alice, a.id, erin.email).expect(201);
      await inviteToOrganization(frank, f.id, erin.email).expect(201);

      const inA = await createProject(alice, a.id);
      const alsoInA = await createProject(alice, a.id);
      const inF = await createProject(frank, f.id);
      expect(inA.organizationId).toBe(a.id);
      await addToProject(alice, inA.id, erin, 'editor');
      await addToProject(frank, inF.id, erin, 'viewer');

      expect(await projectIds(erin, a.id)).toEqual([inA.id]);
      expect(await projectIds(erin, f.id)).toEqual([inF.id]);
      expect(await projectIds(erin, e.id)).toEqual([]);
      expect(await projectIds(erin)).toEqual([inA.id, inF.id].sort(byText));
      await request(server()).get(`/api/v1/projects/${alsoInA.id}`).set(auth(erin)).expect(404);
      // Not a member: the list of another organization is not found
      await request(server()).get('/api/v1/projects').query({ organizationId: a.id }).set(auth(frank)).expect(404);
      // Nor can anyone create a project there
      await request(server()).post('/api/v1/projects').set(auth(frank)).send({ name: 'Intruder', organizationId: a.id }).expect(404);
      // Without organizationId: the caller's own organization
      expect((await createProject(erin)).organizationId).toBe(e.id);
    });

    it('makes an organization owner and admin an implicit admin of every project of it', async () => {
      const owner = await signupTestUser(app, 'implicit-owner@test.com');
      const member = await signupTestUser(app, 'implicit-member@test.com');
      const organization = await onlyOrganizationOf(owner);
      await inviteToOrganization(owner, organization.id, member.email).expect(201);
      const theirs = await createProject(member, organization.id);

      const listed = (await request(server()).get('/api/v1/projects').query({ organizationId: organization.id }).set(auth(owner)).expect(200)).body
        .data;
      expect(listed.map(p => [p.id, p.role])).toEqual([[theirs.id, 'admin']]);
      const read = await request(server()).get(`/api/v1/projects/${theirs.id}`).set(auth(owner)).expect(200);
      expect(read.body.data.role).toBe('admin');
      await request(server()).get(`/api/v1/projects/${theirs.id}/users`).set(auth(owner)).expect(200);
    });

    it('locks the members of a suspended organization out of its projects at once', async () => {
      const owner = await signupTestUser(app, 'suspended-owner@test.com');
      const organization = await onlyOrganizationOf(owner);
      const project = await createProject(owner, organization.id);
      await dataSource.getRepository(Organization).update({ id: organization.id }, { status: OrganizationStatus.Suspended });
      const res = await request(server()).get(`/api/v1/projects/${project.id}`).set(auth(owner)).expect(403);
      expect(res.body.error.code).toBe('organization_suspended');
      await request(server()).get(`/api/v1/organizations/${organization.id}`).set(auth(owner)).expect(403);
      expect(await organizationsOf(owner)).toEqual([]);
      await dataSource.getRepository(Organization).update({ id: organization.id }, { status: OrganizationStatus.Active });
      await request(server()).get(`/api/v1/projects/${project.id}`).set(auth(owner)).expect(200);
    });

    it('puts an invitee of a project into its organization first', async () => {
      const owner = await signupTestUser(app, 'project-invite-owner@test.com');
      const organization = await onlyOrganizationOf(owner);
      const project = await createProject(owner, organization.id);
      const invited = await request(server())
        .post(`/api/v1/projects/${project.id}/invites`)
        .set(auth(owner))
        .send({ email: 'project-invitee@test.com', role: 'editor' })
        .expect(201);
      const token = new URL(invited.body.data.inviteUrl).searchParams.get('invite');
      const signup = await request(server())
        .post('/api/v1/auth/signup')
        .send({ name: 'Project Invitee', email: 'project-invitee@test.com', password: 'mysupersecretpassword', inviteToken: token })
        .expect(200);
      const invitee = signup.body.data as TestingUser;
      expect((await organizationsOf(invitee)).map(o => [o.id, o.role])).toEqual([[organization.id, 'member']]);
      expect(await projectIds(invitee)).toEqual([project.id]);
    });

    it('lets only owners and admins bring new people into the organization through a project invite', async () => {
      const owner = await signupTestUser(app, 'gate-owner@test.com');
      const member = await signupTestUser(app, 'gate-member@test.com');
      const colleague = await signupTestUser(app, 'gate-colleague@test.com');
      const outsider = await signupTestUser(app, 'gate-outsider@test.com');
      const organization = await onlyOrganizationOf(owner);
      await inviteToOrganization(owner, organization.id, member.email).expect(201);
      await inviteToOrganization(owner, organization.id, colleague.email).expect(201);
      // A member creates a project and is its admin
      const theirs = await createProject(member, organization.id);

      // ...but cannot bring anyone new into the organization, with or without an account
      for (const email of [outsider.email, 'gate-nobody@test.com']) {
        const refused = await request(server())
          .post(`/api/v1/projects/${theirs.id}/invites`)
          .set(auth(member))
          .send({ email, role: 'viewer' })
          .expect(403);
        expect(refused.body.error.code).toBe('organization_admin_required');
      }
      expect((await organizationsOf(outsider)).map(o => o.id)).not.toContain(organization.id);

      // A member of the organization joins the project as before
      await request(server())
        .post(`/api/v1/projects/${theirs.id}/invites`)
        .set(auth(member))
        .send({ email: colleague.email, role: 'viewer' })
        .expect(201);
      expect(await projectIds(colleague, organization.id)).toEqual([theirs.id]);

      // The owner (an implicit project admin here) may bring the outsider in
      await request(server())
        .post(`/api/v1/projects/${theirs.id}/invites`)
        .set(auth(owner))
        .send({ email: outsider.email, role: 'viewer' })
        .expect(201);
      expect((await organizationsOf(outsider)).map(o => [o.id, o.role])).toContainEqual([organization.id, 'member']);
    });

    it('lets an API key reach its own project only', async () => {
      const owner = await signupTestUser(app, 'client-owner@test.com');
      const project = await createProject(owner);
      const other = await createProject(owner);
      const client = await request(server())
        .post(`/api/v1/projects/${project.id}/clients`)
        .set(auth(owner))
        .send({ name: 'ci', role: 'viewer' })
        .expect(201);
      const token = await request(server())
        .post('/api/v1/auth/token')
        .send({ grant_type: 'client_credentials', client_id: client.body.data.id, client_secret: client.body.data.secret })
        .expect(200);
      const key = { Authorization: `Bearer ${token.body.access_token}` };
      await request(server()).get(`/api/v1/projects/${project.id}/terms`).set(key).expect(200);
      await request(server()).get(`/api/v1/projects/${other.id}/terms`).set(key).expect(404);
      await request(server()).get('/api/v1/organizations').set(key).expect(401);
    });
  });
});

describe('Organizations in single-tenant mode (e2e)', () => {
  let app: INestApplication;
  const saasBefore = config.saasEnabled;

  beforeAll(async () => {
    config.saasEnabled = false;
    app = await createAndMigrateApp();
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    await app.close();
  });

  it('answers only the default organization, and nothing else', async () => {
    const first = await signupTestUser(app, 'single-first@test.com');
    const second = await signupTestUser(app, 'single-second@test.com');
    const auth = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });
    const list = await request(app.getHttpServer()).get('/api/v1/organizations').set(auth(second)).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ slug: 'default', isDefault: true, adminsSeeAllProjects: false, role: 'member' });
    const id = list.body.data[0].id;
    expect((await request(app.getHttpServer()).get('/api/v1/organizations').set(auth(first)).expect(200)).body.data[0].role).toBe('owner');

    const providers = await request(app.getHttpServer()).get('/api/v1/auth/providers').expect(200);
    expect(providers.body.saas).toBe(false);

    for (const [method, path] of [
      ['post', '/api/v1/organizations'],
      ['get', `/api/v1/organizations/${id}/members`],
      ['get', `/api/v1/organizations/${id}/invites`],
      ['post', `/api/v1/organizations/${id}/invites`],
      ['patch', `/api/v1/organizations/${id}`],
      ['post', `/api/v1/organizations/${id}/transfer-ownership`],
      ['post', '/api/v1/auth/accept-organization-invite'],
    ]) {
      const res = await request(app.getHttpServer())
        [method](path)
        .set(auth(first))
        .send({ name: 'Valid name', slug: 'valid-slug', email: 'x@test.com', role: 'member', userId: second.id, inviteToken: 'x' });
      expect([path, res.status, res.body.error?.code]).toEqual([path, 404, 'saas_disabled']);
    }

    // Projects go to the default organization; nobody sees another's project
    const project = (await request(app.getHttpServer()).post('/api/v1/projects').set(auth(second)).send({ name: 'Mine' }).expect(201)).body.data;
    expect(project.organizationId).toBe(id);
    expect((await request(app.getHttpServer()).get('/api/v1/projects').set(auth(first)).expect(200)).body.data).toEqual([]);
    await request(app.getHttpServer()).get(`/api/v1/projects/${project.id}`).set(auth(first)).expect(404);
  });
});
