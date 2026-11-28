import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { writeFileSync } from 'fs';
import * as request from 'supertest';
import { DataSource, In } from 'typeorm';
import { parseAccessRule } from '../src/access/access.decorator';
import { controllersOf, routesOf } from '../src/access/routes';
import { AppModule } from '../src/app.module';
import { config } from '../src/config';
import { OrganizationStatus } from '../src/domain/organization-actions';
import { Invite } from '../src/entity/invite.entity';
import { Label } from '../src/entity/label.entity';
import { OrganizationInvite } from '../src/entity/organization-invite.entity';
import { OrganizationUser } from '../src/entity/organization-user.entity';
import { Organization } from '../src/entity/organization.entity';
import { ProjectClient } from '../src/entity/project-client.entity';
import { ProjectLocale } from '../src/entity/project-locale.entity';
import { ProjectUser } from '../src/entity/project-user.entity';
import { Project } from '../src/entity/project.entity';
import { Term } from '../src/entity/term.entity';
import { Translation } from '../src/entity/translation.entity';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

/**
 * DESIGN §10, the isolation suite. Organizations A and B each have an owner, an admin, a member, a project with
 * locales, terms, translations, a label, an API key and pending invites, and one person is a member of both. Nothing of
 * B can be read, listed, counted, changed, deleted or guessed from A: every project route (taken from the routes
 * themselves, so a new one is covered the day it is added), the project and organization lists, the organization
 * routes, imports, exports, API keys and invitation tokens. A suspended organization locks its people out at once.
 *
 * The mutation check runs this file against an organization scope without boundaries
 * (`yarn test:isolation:mutation`): most of these tests must then fail.
 */

interface Side {
  organizationId: string;
  owner: TestingUser;
  admin: TestingUser;
  member: TestingUser;
  projectId: string;
  termIds: string[];
  labelId: string;
  clientId: string;
  keyToken: string;
  projectInviteId: string;
  projectInviteToken: string;
  organizationInviteId: string;
  organizationInviteToken: string;
}

const byText = (left: unknown, right: unknown) => String(left).localeCompare(String(right));
const METHOD_ORDER = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const PROJECT_ROOT = '/api/v1/projects/:projectId';

/** Every project route, reads first, the project's own deletion last. */
const PROJECT_ROUTES = routesOf(controllersOf([AppModule]))
  .filter(route => parseAccessRule(route.access?.rule)?.kind === 'project')
  .sort((a, b) => {
    const last = (route: { method: string; path: string }) => (route.method === 'DELETE' && route.path === PROJECT_ROOT ? 1 : 0);
    return last(a) - last(b) || METHOD_ORDER.indexOf(a.method) - METHOD_ORDER.indexOf(b.method) || a.path.localeCompare(b.path);
  })
  .map(route => ({ method: route.method, path: route.path, name: `${route.method} ${route.path}` }));

describe('Organization isolation (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let a: Side;
  let b: Side;
  let both: TestingUser;
  const saasBefore = config.saasEnabled;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const tokenOf = (inviteUrl: string) => new URL(inviteUrl).searchParams.get('invite');

  async function signup(email: string, organizationName?: string): Promise<TestingUser> {
    if (!organizationName) {
      return signupTestUser(app, email);
    }
    const res = await request(server())
      .post('/api/v1/auth/signup')
      .send({ name: email, email, password: 'mysupersecretpassword', organizationName })
      .expect(200);
    await dataSource.getRepository('User').update({ id: res.body.data.id }, { emailVerified: true });
    return res.body.data;
  }

  /** One organization with its people, a project full of data, an API key and pending invites. */
  async function makeSide(name: string): Promise<Side> {
    const slug = name.toLowerCase();
    const owner = await signup(`owner-${slug}@test.com`, `Isolation ${name}`);
    const organization = (await request(server()).get('/api/v1/organizations').set(auth(owner.accessToken)).expect(200)).body.data.find(
      o => o.name === `Isolation ${name}`,
    );
    const admin = await signup(`admin-${slug}@test.com`);
    const member = await signup(`member-${slug}@test.com`);
    const as = (user: TestingUser) => auth(user.accessToken);
    await request(server())
      .post(`/api/v1/organizations/${organization.id}/invites`)
      .set(as(owner))
      .send({ email: admin.email, role: 'admin' })
      .expect(201);
    await request(server())
      .post(`/api/v1/organizations/${organization.id}/invites`)
      .set(as(owner))
      .send({ email: member.email, role: 'member' })
      .expect(201);

    const project = (
      await request(server())
        .post('/api/v1/projects')
        .set(as(owner))
        .send({ name: `Project ${name}`, organizationId: organization.id })
        .expect(201)
    ).body.data;
    const base = `/api/v1/projects/${project.id}`;
    await request(server()).post(`${base}/translations`).set(as(owner)).send({ code: 'en' }).expect(201);
    await request(server()).post(`${base}/translations`).set(as(owner)).send({ code: 'de' }).expect(201);
    const termIds: string[] = [];
    for (const value of [`hello.${slug}`, `bye.${slug}`]) {
      termIds.push((await request(server()).post(`${base}/terms`).set(as(owner)).send({ value }).expect(201)).body.data.id);
    }
    await request(server())
      .patch(`${base}/translations/de`)
      .set(as(owner))
      .send({ termId: termIds[0], value: `hallo ${name}` })
      .expect(200);
    const labelId = (
      await request(server())
        .post(`${base}/labels`)
        .set(as(owner))
        .send({ value: `web-${slug}`, color: '#336699' })
        .expect(201)
    ).body.data.id;
    await request(server()).post(`${base}/labels/${labelId}/terms/${termIds[0]}`).set(as(owner)).expect(201);
    await request(server()).post(`${base}/invites`).set(as(owner)).send({ email: member.email, role: 'editor' }).expect(201);
    const client = (
      await request(server())
        .post(`${base}/clients`)
        .set(as(owner))
        .send({ name: `ci-${slug}`, role: 'editor' })
        .expect(201)
    ).body.data;
    const keyToken = (
      await request(server())
        .post('/api/v1/auth/token')
        .send({ grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret })
        .expect(200)
    ).body.access_token;
    const projectInvite = (
      await request(server())
        .post(`${base}/invites`)
        .set(as(owner))
        .send({ email: `pending-project-${slug}@test.com`, role: 'viewer' })
        .expect(201)
    ).body.data;
    const organizationInvite = (
      await request(server())
        .post(`/api/v1/organizations/${organization.id}/invites`)
        .set(as(owner))
        .send({ email: `pending-organization-${slug}@test.com`, role: 'member' })
        .expect(201)
    ).body.data;
    return {
      organizationId: organization.id,
      owner,
      admin,
      member,
      projectId: project.id,
      termIds,
      labelId,
      clientId: client.id,
      keyToken,
      projectInviteId: projectInvite.id,
      projectInviteToken: tokenOf(projectInvite.inviteUrl),
      organizationInviteId: organizationInvite.id,
      organizationInviteToken: tokenOf(organizationInvite.inviteUrl),
    };
  }

  /** Everything B holds, to show at the end that nothing of it changed. */
  async function snapshot(side: Side) {
    const projectId = side.projectId;
    const locales = await dataSource.getRepository(ProjectLocale).find({ where: { project: { id: projectId } } });
    const project = await dataSource.getRepository(Project).findOneBy({ id: projectId });
    const organization = await dataSource.getRepository(Organization).findOneBy({ id: side.organizationId });
    return {
      projectsOfOrganization: await dataSource.getRepository(Project).count({ where: { organizationId: side.organizationId } }),
      project: project && { name: project.name, description: project.description, organizationId: project.organizationId },
      organization: organization && { name: organization.name, slug: organization.slug, status: organization.status },
      terms: (await dataSource.getRepository(Term).find({ where: { project: { id: projectId } } })).map(t => t.value).sort(byText),
      locales: locales.length,
      translations: (await dataSource.getRepository(Translation).find({ where: { projectLocale: { id: In(locales.map(l => l.id)) } } }))
        .map(t => t.value)
        .sort(byText),
      labels: (await dataSource.getRepository(Label).find({ where: { project: { id: projectId } } })).map(l => l.value).sort(byText),
      projectUsers: (await dataSource.getRepository(ProjectUser).find({ where: { project: { id: projectId } }, relations: ['user'] }))
        .map(m => `${m.user.id}:${m.role}`)
        .sort(byText),
      projectInvites: (await dataSource.getRepository(Invite).find({ where: { project: { id: projectId } } }))
        .map(i => `${i.email}:${i.status}`)
        .sort(byText),
      clients: (await dataSource.getRepository(ProjectClient).find({ where: { project: { id: projectId } } }))
        .map(c => `${c.name}:${c.role}`)
        .sort(byText),
      members: (await dataSource.getRepository(OrganizationUser).find({ where: { organizationId: side.organizationId } }))
        .map(m => `${m.userId}:${m.role}`)
        .sort(byText),
      organizationInvites: (await dataSource.getRepository(OrganizationInvite).find({ where: { organizationId: side.organizationId } }))
        .map(i => `${i.email}:${i.status}:${i.role}`)
        .sort(byText),
    };
  }
  let before: Awaited<ReturnType<typeof snapshot>>;

  /** The route with `side`'s real ids in its parameters (`projectId` from `projectSide`, the children from `side`). */
  const urlFor = (path: string, side: Side, projectSide: Side = side) =>
    path
      .replace(':projectId', projectSide.projectId)
      .replace(':termId', side.termIds[0])
      .replace(':labelId', side.labelId)
      .replace(':localeCode', 'de')
      .replace(':userId', side.member.id)
      .replace(':inviteId', side.projectInviteId)
      .replace(':clientId', side.clientId) + (path.endsWith('/exports') ? '?locale=de&format=jsonflat' : '');

  /** A body every route would accept, aimed at B's own ids, so only the access checks stand in the way. */
  const bodyFor = (side: Side) => ({
    name: 'Taken over',
    description: 'Taken over',
    value: 'taken.over',
    role: 'admin',
    code: 'fr',
    termId: side.termIds[1],
    color: '#000000',
    email: 'taken-over@test.com',
    context: 'taken over',
    labels: [],
  });

  const call = (method: string, url: string, token: string, body?: object) => {
    const req = request(server())[method.toLowerCase()](url).set(auth(token));
    return method === 'GET' || method === 'DELETE' ? req : req.send(body ?? {});
  };

  beforeAll(async () => {
    config.saasEnabled = true;
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);
    a = await makeSide('A');
    b = await makeSide('B');

    // One person in both organizations: a member of each, a viewer of B's project only
    both = await signup('both@test.com');
    for (const side of [a, b]) {
      await request(server())
        .post(`/api/v1/organizations/${side.organizationId}/invites`)
        .set(auth(side.owner.accessToken))
        .send({ email: both.email, role: 'member' })
        .expect(201);
    }
    await request(server())
      .post(`/api/v1/projects/${b.projectId}/invites`)
      .set(auth(b.owner.accessToken))
      .send({ email: both.email, role: 'viewer' })
      .expect(201);

    before = await snapshot(b);
    // For the mutation check (test/mutation/run-isolation-mutation.js): the fixtures were made, so the failures it counts
    // are the isolation assertions, never a broken setup
    if (process.env.ISOLATION_SETUP_MARKER) {
      writeFileSync(process.env.ISOLATION_SETUP_MARKER, 'ready');
    }
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    await app.close();
  });

  it('covers every project route', () => {
    expect(PROJECT_ROUTES.length).toBeGreaterThan(35);
  });

  describe('guessing', () => {
    it.each(PROJECT_ROUTES.filter(route => route.method === 'GET'))(
      "cannot tell B's real project from one that does not exist: $name",
      async route => {
        const real = await call('GET', urlFor(route.path, b), a.owner.accessToken);
        const made = await call('GET', urlFor(route.path, b).replace(b.projectId, randomUUID()), a.owner.accessToken);
        expect([real.status, real.body]).toEqual([made.status, made.body]);
      },
    );
  });

  describe("B's children through A's own project", () => {
    it.each(PROJECT_ROUTES.filter(route => /:(termId|labelId|userId|inviteId|clientId)/.test(route.path)))('$name', async route => {
      const res = await call(route.method, urlFor(route.path, b, a), a.owner.accessToken, bodyFor(b));
      expect(res.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe('each child of a nested route on its own', () => {
    const nested = PROJECT_ROUTES.filter(route => route.path.includes(':labelId/terms/:termId'));
    const urlWith = (path: string, labelId: string, termId: string) =>
      path.replace(':projectId', a.projectId).replace(':labelId', labelId).replace(':termId', termId).replace(':localeCode', 'de');

    it.each(nested)("A's label with B's term: $name", async route => {
      const res = await call(route.method, urlWith(route.path, a.labelId, b.termIds[0]), a.owner.accessToken);
      expect(res.status).toBe(404);
    });

    it.each(nested)("B's label with A's term: $name", async route => {
      const res = await call(route.method, urlWith(route.path, b.labelId, a.termIds[0]), a.owner.accessToken);
      expect(res.status).toBe(404);
    });

    it("leaves A's own label on A's term", async () => {
      const labelled = await dataSource.getRepository(Term).findOne({ where: { id: a.termIds[0] }, relations: ['labels'] });
      expect(labelled.labels.map(label => label.id)).toEqual([a.labelId]);
    });
  });

  describe("B's ids in a request body", () => {
    it("translates none of B's terms through A's own project", async () => {
      await request(server())
        .patch(`/api/v1/projects/${a.projectId}/translations/de`)
        .set(auth(a.owner.accessToken))
        .send({ termId: b.termIds[1], value: 'taken over' })
        .expect(404);
    });
  });

  describe('creating projects', () => {
    it.each(['owner', 'admin', 'member'])("refuses a project in B to A's %s", async who => {
      await request(server())
        .post('/api/v1/projects')
        .set(auth(a[who].accessToken))
        .send({ name: 'Planted', organizationId: b.organizationId })
        .expect(404);
      expect(await dataSource.getRepository(Project).count({ where: { organizationId: b.organizationId } })).toBe(before.projectsOfOrganization);
    });

    it('creates the project of the person in both organizations where they say, in A here, never in B', async () => {
      const created = await request(server())
        .post('/api/v1/projects')
        .set(auth(both.accessToken))
        .send({ name: 'From both', organizationId: a.organizationId })
        .expect(201);
      expect(created.body.data.organizationId).toBe(a.organizationId);
      expect(await dataSource.getRepository(Project).count({ where: { organizationId: b.organizationId } })).toBe(before.projectsOfOrganization);
      await request(server()).delete(`/api/v1/projects/${created.body.data.id}`).set(auth(both.accessToken)).expect(204);
    });
  });

  describe('lists', () => {
    it("lists none of B's projects to A's people, and refuses B's list", async () => {
      for (const person of [a.owner, a.admin, a.member]) {
        const listed = (await request(server()).get('/api/v1/projects').set(auth(person.accessToken)).expect(200)).body.data.map(p => p.id);
        expect(listed).not.toContain(b.projectId);
        await request(server()).get('/api/v1/projects').query({ organizationId: b.organizationId }).set(auth(person.accessToken)).expect(404);
      }
    });

    it("lists none of B's organizations to A's people", async () => {
      for (const person of [a.owner, a.admin, a.member]) {
        const listed = (await request(server()).get('/api/v1/organizations').set(auth(person.accessToken)).expect(200)).body.data.map(o => o.id);
        expect(listed).not.toContain(b.organizationId);
      }
    });

    it("shows the person in both organizations each one's projects only where they are a member", async () => {
      const list = async (organizationId?: string) =>
        (
          await request(server())
            .get('/api/v1/projects')
            .query(organizationId ? { organizationId } : {})
            .set(auth(both.accessToken))
            .expect(200)
        ).body.data.map(p => [p.id, p.role]);
      expect(await list(a.organizationId)).toEqual([]);
      expect(await list(b.organizationId)).toEqual([[b.projectId, 'viewer']]);
      expect(await list()).toEqual([[b.projectId, 'viewer']]);
      await request(server()).get(`/api/v1/projects/${a.projectId}`).set(auth(both.accessToken)).expect(404);
      await request(server()).get(`/api/v1/projects/${b.projectId}/terms`).set(auth(both.accessToken)).expect(200);
      // A viewer of B changes nothing there
      await request(server()).post(`/api/v1/projects/${b.projectId}/terms`).set(auth(both.accessToken)).send({ value: 'by.both' }).expect(404);
    });

    it('lists no project to an API key, nor any organization', async () => {
      await request(server()).get('/api/v1/projects').set(auth(a.keyToken)).expect(401);
      await request(server()).get('/api/v1/organizations').set(auth(a.keyToken)).expect(401);
    });
  });

  describe("B's organization routes, from A's people", () => {
    const organizationRoutes = () => [
      ['GET', `/api/v1/organizations/${b.organizationId}`],
      ['PATCH', `/api/v1/organizations/${b.organizationId}`],
      ['GET', `/api/v1/organizations/${b.organizationId}/members`],
      ['PATCH', `/api/v1/organizations/${b.organizationId}/members/${b.member.id}`],
      ['DELETE', `/api/v1/organizations/${b.organizationId}/members/${b.member.id}`],
      ['POST', `/api/v1/organizations/${b.organizationId}/transfer-ownership`],
      ['GET', `/api/v1/organizations/${b.organizationId}/invites`],
      ['POST', `/api/v1/organizations/${b.organizationId}/invites`],
      ['DELETE', `/api/v1/organizations/${b.organizationId}/invites/${b.organizationInviteId}`],
      ['GET', `/api/v1/organizations/${b.organizationId}/usage`],
      ['GET', `/api/v1/organizations/${b.organizationId}/export`],
      ['DELETE', `/api/v1/organizations/${b.organizationId}`],
      // The operator console is for the installation's operators only, never for an organization's people
      ['GET', `/api/v1/operator/organizations/${b.organizationId}`],
      ['POST', `/api/v1/operator/organizations/${b.organizationId}/suspend`],
    ];

    it.each(['owner', 'admin', 'member'])("refuses every one to A's %s", async who => {
      const token = a[who].accessToken;
      const answers = [];
      for (const [method, url] of organizationRoutes()) {
        const res = await call(method, url, token, {
          name: 'Taken over',
          slug: 'taken-over',
          role: 'admin',
          userId: a.owner.id,
          email: 'x@test.com',
        });
        answers.push(`${method} ${url} ${res.status}`);
      }
      expect(answers).toEqual(organizationRoutes().map(([method, url]) => `${method} ${url} 404`));
    });

    it('lets the person in both organizations see B as a member, and change nothing', async () => {
      await request(server()).get(`/api/v1/organizations/${b.organizationId}/members`).set(auth(both.accessToken)).expect(200);
      // The usage is for the owner and the admins: a member of B does not see it, whatever they are in A
      await request(server()).get(`/api/v1/organizations/${b.organizationId}/usage`).set(auth(both.accessToken)).expect(404);
      // Nor its export, nor its deletion: those are the owner's and the admins'
      await request(server()).get(`/api/v1/organizations/${b.organizationId}/export`).set(auth(both.accessToken)).expect(404);
      await request(server())
        .delete(`/api/v1/organizations/${b.organizationId}`)
        .set(auth(both.accessToken))
        .send({ slug: (await dataSource.getRepository(Organization).findOneBy({ id: b.organizationId })).slug })
        .expect(404);
      await request(server())
        .patch(`/api/v1/organizations/${b.organizationId}/members/${b.member.id}`)
        .set(auth(both.accessToken))
        .send({ role: 'admin' })
        .expect(404);
      await request(server())
        .post(`/api/v1/organizations/${b.organizationId}/invites`)
        .set(auth(both.accessToken))
        .send({ email: 'by-both@test.com', role: 'member' })
        .expect(404);
      await request(server())
        .post(`/api/v1/projects/${b.projectId}/invites`)
        .set(auth(both.accessToken))
        .send({ email: a.owner.email, role: 'viewer' })
        .expect(404);
    });

    it('counts only its own projects in the usage of each organization', async () => {
      for (const side of [a, b]) {
        const usage = await request(server()).get(`/api/v1/organizations/${side.organizationId}/usage`).set(auth(side.owner.accessToken)).expect(200);
        const projects = await dataSource.getRepository(Project).find({ where: { organizationId: side.organizationId } });
        expect(usage.body.data.strings.used).toBe(projects.reduce((sum, project) => sum + project.localesCount * project.termsCount, 0));
        expect(usage.body.data.strings.used).toBeGreaterThan(0);
      }
    });
  });

  describe('API keys, imports and exports', () => {
    it('keeps each API key to its own project', async () => {
      await request(server()).get(`/api/v1/projects/${b.projectId}/terms`).set(auth(a.keyToken)).expect(404);
      await request(server()).get(`/api/v1/projects/${a.projectId}/terms`).set(auth(b.keyToken)).expect(404);
      await request(server()).get(`/api/v1/projects/${a.projectId}/terms`).set(auth(a.keyToken)).expect(200);
    });

    it("imports nothing into B and exports nothing of B, for A's people and A's key", async () => {
      for (const token of [a.owner.accessToken, a.keyToken]) {
        await request(server())
          .post(`/api/v1/projects/${b.projectId}/imports?locale=de&format=jsonflat`)
          .set(auth(token))
          .attach('file', Buffer.from(JSON.stringify({ 'taken.over': 'yes' })), 'de.json')
          .expect(404);
        await request(server()).get(`/api/v1/projects/${b.projectId}/exports?locale=de&format=jsonflat`).set(auth(token)).expect(404);
      }
      // A's own export works, and holds none of B's terms
      const own = await request(server()).get(`/api/v1/projects/${a.projectId}/exports?locale=de&format=jsonflat`).set(auth(a.keyToken)).expect(200);
      const exported = Buffer.isBuffer(own.body) ? own.body.toString('utf8') : (own.text ?? JSON.stringify(own.body));
      expect(exported).toContain('hello.a');
      expect(exported).not.toContain('hello.b');
    });
  });

  describe('invitation tokens', () => {
    it("accepts none of B's invitations for anyone of A", async () => {
      for (const person of [a.owner, a.member]) {
        await request(server())
          .post('/api/v1/auth/accept-invite')
          .set(auth(person.accessToken))
          .send({ inviteToken: b.projectInviteToken })
          .expect(404);
        await request(server())
          .post('/api/v1/auth/accept-organization-invite')
          .set(auth(person.accessToken))
          .send({ inviteToken: b.organizationInviteToken })
          .expect(404);
      }
      // Nor A's own invitations for someone else's email
      await request(server())
        .post('/api/v1/auth/accept-organization-invite')
        .set(auth(b.owner.accessToken))
        .send({ inviteToken: a.organizationInviteToken })
        .expect(404);
    });
  });

  describe('a suspended organization', () => {
    it('locks its people and its API key out at once, and lets them back when it is restored', async () => {
      await dataSource.getRepository(Organization).update({ id: b.organizationId }, { status: OrganizationStatus.Suspended });
      try {
        for (const token of [b.owner.accessToken, b.member.accessToken, both.accessToken, b.keyToken]) {
          const res = await request(server()).get(`/api/v1/projects/${b.projectId}/terms`).set(auth(token)).expect(403);
          expect(res.body.error.code).toBe('organization_suspended');
        }
        await request(server()).get(`/api/v1/organizations/${b.organizationId}`).set(auth(b.owner.accessToken)).expect(403);
        await request(server()).get('/api/v1/projects').query({ organizationId: b.organizationId }).set(auth(b.owner.accessToken)).expect(404);
        const listed = (await request(server()).get('/api/v1/projects').set(auth(both.accessToken)).expect(200)).body.data.map(p => p.id);
        expect(listed).not.toContain(b.projectId);
      } finally {
        await dataSource.getRepository(Organization).update({ id: b.organizationId }, { status: OrganizationStatus.Active });
      }
      await request(server()).get(`/api/v1/projects/${b.projectId}/terms`).set(auth(b.owner.accessToken)).expect(200);
    });
  });

  describe("an operator's suspension", () => {
    it('locks B out at its next request, API key too, leaves A working, and is audited', async () => {
      const operatorsBefore = process.env.TR_EVER_ADMIN_EMAILS;
      // The console takes only operators the environment names
      process.env.TR_EVER_ADMIN_EMAILS = config.everPlatform.adminEmails[0];
      const operator = await signupTestUser(app, config.everPlatform.adminEmails[0]);
      const operatorCall = (action: string) =>
        request(server())
          .post(`/api/v1/operator/organizations/${b.organizationId}/${action}`)
          .set(auth(operator.accessToken))
          .send({ reason: `Isolation suite: ${action}` })
          .expect(200);
      await operatorCall('suspend');
      try {
        for (const token of [b.owner.accessToken, b.admin.accessToken, b.member.accessToken, both.accessToken, b.keyToken]) {
          const res = await request(server()).get(`/api/v1/projects/${b.projectId}/terms`).set(auth(token)).expect(403);
          expect(res.body.error.code).toBe('organization_suspended');
        }
        await request(server()).get(`/api/v1/organizations/${b.organizationId}/export`).set(auth(b.owner.accessToken)).expect(403);
        // A is not B: its people and its key keep working
        await request(server()).get(`/api/v1/projects/${a.projectId}/terms`).set(auth(a.member.accessToken)).expect(200);
        await request(server()).get(`/api/v1/projects/${a.projectId}/terms`).set(auth(a.keyToken)).expect(200);
      } finally {
        await operatorCall('restore');
      }
      await request(server()).get(`/api/v1/projects/${b.projectId}/terms`).set(auth(b.member.accessToken)).expect(200);
      await request(server()).get(`/api/v1/projects/${b.projectId}/terms`).set(auth(b.keyToken)).expect(200);
      const audit = (
        await request(server()).get('/api/v1/operator/audit').query({ organizationId: b.organizationId }).set(auth(operator.accessToken)).expect(200)
      ).body.data;
      expect(audit.map(row => [row.action, row.reason, row.operator.userId])).toEqual([
        ['restore', 'Isolation suite: restore', operator.id],
        ['suspend', 'Isolation suite: suspend', operator.id],
      ]);
      if (operatorsBefore === undefined) {
        delete process.env.TR_EVER_ADMIN_EMAILS;
      } else {
        process.env.TR_EVER_ADMIN_EMAILS = operatorsBefore;
      }
    });
  });

  // Last before the final check: with the organization scope removed (the mutation check), these calls change and delete
  // B's data, which must not hide what the tests above measure
  describe("every project route, with B's real ids, from A's owner, admin, member and API key", () => {
    it.each(PROJECT_ROUTES)('$name', async route => {
      const answers: string[] = [];
      for (const [who, token] of [
        ['owner', a.owner.accessToken],
        ['admin', a.admin.accessToken],
        ['member', a.member.accessToken],
        ['API key', a.keyToken],
      ]) {
        const res = await call(route.method, urlFor(route.path, b), token, bodyFor(b));
        answers.push(`${who} ${res.status}`);
      }
      expect(answers).toEqual(['owner 404', 'admin 404', 'member 404', 'API key 404']);
    });
  });

  it('leaves everything of B exactly as it was', async () => {
    expect(await snapshot(b)).toEqual(before);
    // And B's people still reach it
    await request(server()).get(`/api/v1/projects/${b.projectId}/translations/de`).set(auth(b.member.accessToken)).expect(200);
  });
});
