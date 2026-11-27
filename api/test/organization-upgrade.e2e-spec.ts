import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { config } from '../src/config';
import { OrganizationRole } from '../src/domain/organization-actions';
import { OrganizationUser } from '../src/entity/organization-user.entity';
import { Organization } from '../src/entity/organization.entity';
import { Project } from '../src/entity/project.entity';
import { User } from '../src/entity/user.entity';
import { addOrganizations1795478400000 } from '../src/migrations/1795478400000-add-organizations';
import { engineColumnName, quoteName } from '../src/utils/ever-platform-tables';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

/** The tables that exist before organizations: the upgrade must leave every one of their rows in place. */
const EXISTING_TABLES = [
  'user',
  'project',
  'project_user',
  'project_locale',
  'project_client',
  'term',
  'translation',
  'translation_history',
  'label',
  'invite',
  'plan',
  'locale',
];

/**
 * DESIGN §10 upgrade test: a database with projects and members from before organizations is migrated, and nothing is
 * lost. The data is made through the API, then the organizations migration is undone (the schema of the previous
 * release, with that data) and run again.
 */
describe('Upgrade to organizations (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let ada: TestingUser; // earliest account, only a viewer
  let bob: TestingUser; // earliest project admin
  let cyd: TestingUser; // editor, and admin of a project of her own
  let dan: TestingUser; // no project
  let shared: TestingProject;
  let second: TestingProject;
  let cydsOwn: TestingProject;

  const db = () => config.db.default.type;
  const q = (name: string) => quoteName(db(), name);
  const c = (name: string) => q(engineColumnName(db(), name));
  const server = () => app.getHttpServer();
  const auth = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });

  async function countRows(): Promise<Record<string, number>> {
    const counts: Record<string, number> = {};
    for (const table of EXISTING_TABLES) {
      const [row] = await dataSource.query(`SELECT COUNT(*) AS ${q('n')} FROM ${q(table)}`);
      counts[table] = Number(Object.values(row)[0]);
    }
    return counts;
  }

  async function setCreated(user: TestingUser, iso: string): Promise<void> {
    const at = new Date(iso);
    await dataSource
      .createQueryBuilder()
      .update(User)
      .set({ date: { created: at } } as any)
      .where('id = :id', { id: user.id })
      .execute();
  }

  async function tableExists(table: string): Promise<boolean> {
    try {
      await dataSource.query(`SELECT COUNT(*) AS ${q('n')} FROM ${q(table)}`);
      return true;
    } catch {
      return false;
    }
  }

  async function undoAndMigrate(): Promise<void> {
    const executed: Array<{ name: string }> = await dataSource.query(`SELECT ${c('name')} AS ${q('name')} FROM ${q('migrations')}`);
    expect(executed.map(row => row.name)).toContain('addOrganizations1795478400000');
    await dataSource.undoLastMigration();
    // The schema of the previous release: no organizations, no project.organization_id
    expect(await tableExists('organization')).toBe(false);
    expect(await tableExists('organization_user')).toBe(false);
    await expect(dataSource.query(`SELECT ${c('organization_id')} FROM ${q('project')}`)).rejects.toBeTruthy();
    const ran = await dataSource.runMigrations();
    expect(ran.map(migration => migration.name)).toEqual(['addOrganizations1795478400000']);
  }

  const memberships = () => dataSource.getRepository(OrganizationUser).find({ relations: ['organization'] });
  const roleOf = async (user: TestingUser) => (await memberships()).filter(m => m.userId === user.id).map(m => m.role);

  beforeAll(async () => {
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);

    ada = await signupTestUser(app, 'ada@test.com');
    bob = await signupTestUser(app, 'bob@test.com');
    cyd = await signupTestUser(app, 'cyd@test.com');
    dan = await signupTestUser(app, 'dan@test.com');

    shared = await createTestProject(app, bob);
    second = await createTestProject(app, bob);
    cydsOwn = await createTestProject(app, cyd);

    // Members, locales, terms, translations, labels, an API key and pending invites
    await request(server()).post(`/api/v1/projects/${shared.id}/invites`).set(auth(bob)).send({ email: ada.email, role: 'viewer' }).expect(201);
    await request(server()).post(`/api/v1/projects/${second.id}/invites`).set(auth(bob)).send({ email: cyd.email, role: 'editor' }).expect(201);
    await request(server())
      .post(`/api/v1/projects/${shared.id}/invites`)
      .set(auth(bob))
      .send({ email: 'someone@test.com', role: 'editor' })
      .expect(201);
    await request(server()).post(`/api/v1/projects/${shared.id}/translations`).set(auth(bob)).send({ code: 'en' }).expect(201);
    await request(server()).post(`/api/v1/projects/${shared.id}/translations`).set(auth(bob)).send({ code: 'de' }).expect(201);
    const term = await request(server()).post(`/api/v1/projects/${shared.id}/terms`).set(auth(bob)).send({ value: 'hello' }).expect(201);
    await request(server())
      .patch(`/api/v1/projects/${shared.id}/translations/de`)
      .set(auth(bob))
      .send({ termId: term.body.data.id, value: 'hallo' })
      .expect(200);
    await request(server()).post(`/api/v1/projects/${shared.id}/labels`).set(auth(bob)).send({ value: 'web', color: '#ff0000' }).expect(201);
    await request(server()).post(`/api/v1/projects/${shared.id}/clients`).set(auth(bob)).send({ name: 'ci', role: 'viewer' }).expect(201);

    // Ada signed up first, Bob is the earliest project admin
    await setCreated(ada, '2020-01-01T00:00:00Z');
    await setCreated(bob, '2020-02-01T00:00:00Z');
    await setCreated(cyd, '2020-03-01T00:00:00Z');
    await setCreated(dan, '2020-04-01T00:00:00Z');
  });

  afterAll(async () => {
    await app.close();
  });

  it('puts every project and user into the default organization, with one owner and nothing lost', async () => {
    const before = await countRows();
    await undoAndMigrate();
    expect(await countRows()).toEqual(before);

    const organizations = await dataSource.getRepository(Organization).find();
    expect(organizations).toHaveLength(1);
    const [organization] = organizations;
    expect(organization).toMatchObject({
      slug: 'default',
      name: config.defaultOrganizationName,
      status: 'active',
      planCode: 'enterprise',
      isDefault: true,
      adminsSeeAllProjects: false,
      seatsUsed: 4,
    });
    // 2 locales × 1 term in the shared project
    expect(organization.stringsUsed).toBe(2);

    const projects = await dataSource.getRepository(Project).find();
    expect(projects).toHaveLength(3);
    expect(projects.every(project => project.organizationId === organization.id)).toBe(true);

    // Every user exactly once; the earliest project admin owns it; nobody becomes admin for being a project admin
    const all = await memberships();
    expect(all).toHaveLength(4);
    expect(await roleOf(bob)).toEqual([OrganizationRole.Owner]);
    expect(await roleOf(ada)).toEqual([OrganizationRole.Member]);
    expect(await roleOf(cyd)).toEqual([OrganizationRole.Member]);
    expect(await roleOf(dan)).toEqual([OrganizationRole.Member]);
  });

  it('leaves everyone exactly the projects they had', async () => {
    const list = async (user: TestingUser) =>
      (await request(server()).get('/api/v1/projects').set(auth(user)).expect(200)).body.data.map(p => [p.id, p.role]).sort();
    // Bob owns the organization but does not see Cyd's project (the default organization has no implicit admin)
    expect(await list(bob)).toEqual(
      [
        [shared.id, 'admin'],
        [second.id, 'admin'],
      ].sort(),
    );
    expect(await list(ada)).toEqual([[shared.id, 'viewer']]);
    expect(await list(cyd)).toEqual(
      [
        [second.id, 'editor'],
        [cydsOwn.id, 'admin'],
      ].sort(),
    );
    expect(await list(dan)).toEqual([]);
    await request(server()).get(`/api/v1/projects/${cydsOwn.id}`).set(auth(bob)).expect(404);
    await request(server()).get(`/api/v1/projects/${shared.id}/terms`).set(auth(ada)).expect(200);
  });

  it('makes the user of TR_ADMIN_EMAIL the owner when they exist', async () => {
    const admin = await signupTestUser(app, config.defaultAdminCredentialConfig.adminEmail);
    // A new account of a single-tenant install joins the default organization as a member
    expect(await roleOf(admin)).toEqual([OrganizationRole.Member]);

    await undoAndMigrate();
    expect(await roleOf(admin)).toEqual([OrganizationRole.Owner]);
    expect(await roleOf(bob)).toEqual([OrganizationRole.Member]);
    expect((await memberships()).filter(m => m.role === OrganizationRole.Owner)).toHaveLength(1);
  });

  it('changes nothing when it runs again', async () => {
    const before = await countRows();
    const membershipsBefore = (await memberships()).map(m => [m.userId, m.role]).sort();
    const queryRunner = dataSource.createQueryRunner();
    try {
      await new addOrganizations1795478400000().up(queryRunner);
    } finally {
      await queryRunner.release();
    }
    expect(await countRows()).toEqual(before);
    expect((await memberships()).map(m => [m.userId, m.role]).sort()).toEqual(membershipsBefore);
    expect(await dataSource.getRepository(Organization).count()).toBe(1);
  });

  it('gives an empty database its default organization, which the first account owns', async () => {
    await dataSource.dropDatabase();
    await dataSource.runMigrations();
    const [organization] = await dataSource.getRepository(Organization).find();
    expect(organization).toMatchObject({ slug: 'default', isDefault: true, adminsSeeAllProjects: false });
    expect(await dataSource.getRepository(OrganizationUser).count()).toBe(0);

    const first = await signupTestUser(app, 'first@test.com');
    const next = await signupTestUser(app, 'next@test.com');
    expect(await roleOf(first)).toEqual([OrganizationRole.Owner]);
    expect(await roleOf(next)).toEqual([OrganizationRole.Member]);
    const project = await createTestProject(app, next);
    const stored = await dataSource.getRepository(Project).findOneByOrFail({ id: project.id });
    expect(stored.organizationId).toBe(organization.id);
  });
});
