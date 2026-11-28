import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { config } from '../src/config';
import { OrganizationRole, OrganizationStatus } from '../src/domain/organization-actions';
import { OperatorAudit } from '../src/entity/operator-audit.entity';
import { OrganizationUser } from '../src/entity/organization-user.entity';
import { Organization } from '../src/entity/organization.entity';
import { User } from '../src/entity/user.entity';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

/**
 * The operator console (DESIGN §3.9): only the installation's operators (a verified e-mail in TR_EVER_ADMIN_EMAILS,
 * else TR_ADMIN_EMAIL) list, search and see every organization, suspend and restore one with a reason, and read the
 * audit log; every action writes its audit row. A suspension locks the organization's people and API keys out at their
 * very next request, and a restore lets them back.
 */
describe('Operator console (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let operator: TestingUser;
  let owner: TestingUser;
  let member: TestingUser;
  let outsider: TestingUser;
  let organization: { id: string; name: string; slug: string };
  let projectId: string;
  let keyToken: string;
  const saasBefore = config.saasEnabled;
  const operatorsBefore = process.env.TR_EVER_ADMIN_EMAILS;

  const server = () => app.getHttpServer();
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const as = (user: TestingUser) => auth(user.accessToken);

  async function signup(email: string, organizationName: string): Promise<TestingUser> {
    const res = await request(server())
      .post('/api/v1/auth/signup')
      .send({ name: email, email, password: 'mysupersecretpassword', organizationName })
      .expect(200);
    await dataSource.getRepository(User).update({ id: res.body.data.id }, { emailVerified: true });
    return res.body.data;
  }

  const suspend = (id: string, reason: unknown = 'Chargeback under review') =>
    request(server()).post(`/api/v1/operator/organizations/${id}/suspend`).set(as(operator)).send({ reason });
  const restore = (id: string, reason: unknown = 'Payment settled') =>
    request(server()).post(`/api/v1/operator/organizations/${id}/restore`).set(as(operator)).send({ reason });

  beforeAll(async () => {
    config.saasEnabled = true;
    // The console takes only operators the environment names (never the built-in fallback address)
    process.env.TR_EVER_ADMIN_EMAILS = config.everPlatform.adminEmails[0];
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);

    // The operator of the installation (TR_EVER_ADMIN_EMAILS, else TR_ADMIN_EMAIL), with a verified e-mail
    operator = await signupTestUser(app, config.everPlatform.adminEmails[0]);
    owner = await signup('owner-acme@test.com', 'Acme Translations');
    member = await signup('member-acme@test.com', 'Member own organization');
    outsider = await signup('outsider@test.com', 'Outsider organization');
    organization = (await request(server()).get('/api/v1/organizations').set(as(owner)).expect(200)).body.data.find(
      o => o.name === 'Acme Translations',
    );
    await request(server())
      .post(`/api/v1/organizations/${organization.id}/invites`)
      .set(as(owner))
      .send({ email: member.email, role: 'member' })
      .expect(201);
    projectId = (
      await request(server()).post('/api/v1/projects').set(as(owner)).send({ name: 'Website', organizationId: organization.id }).expect(201)
    ).body.data.id;
    await request(server()).post(`/api/v1/projects/${projectId}/translations`).set(as(owner)).send({ code: 'en' }).expect(201);
    await request(server()).post(`/api/v1/projects/${projectId}/terms`).set(as(owner)).send({ value: 'hello' }).expect(201);
    await request(server()).post(`/api/v1/projects/${projectId}/invites`).set(as(owner)).send({ email: member.email, role: 'editor' }).expect(201);
    const client = (
      await request(server()).post(`/api/v1/projects/${projectId}/clients`).set(as(owner)).send({ name: 'ci', role: 'viewer' }).expect(201)
    ).body.data;
    keyToken = (
      await request(server())
        .post('/api/v1/auth/token')
        .send({ grant_type: 'client_credentials', client_id: client.id, client_secret: client.secret })
        .expect(200)
    ).body.access_token;
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    restoreEnv('TR_EVER_ADMIN_EMAILS', operatorsBefore);
    await app.close();
  });

  describe('who may call', () => {
    const routes = () => [
      ['GET', '/api/v1/operator/status'],
      ['GET', '/api/v1/operator/organizations'],
      ['GET', `/api/v1/operator/organizations/${organization.id}`],
      ['POST', `/api/v1/operator/organizations/${organization.id}/suspend`],
      ['POST', `/api/v1/operator/organizations/${organization.id}/restore`],
      ['GET', '/api/v1/operator/audit'],
    ];
    const call = (method: string, url: string, token?: string) => {
      const req = request(server())[method.toLowerCase()](url);
      if (token) {
        req.set(auth(token));
      }
      return method === 'POST' ? req.send({ reason: 'Taken over by someone else' }) : req;
    };

    it('answers 404 to people who are not operators (an organization owner too) and to API keys, 401 signed out', async () => {
      const answers = [];
      for (const [method, url] of routes()) {
        for (const [who, token] of [
          ['owner', owner.accessToken],
          ['member', member.accessToken],
          ['outsider', outsider.accessToken],
          ['API key', keyToken],
          ['nobody', undefined],
        ]) {
          answers.push(`${who} ${method} ${url} ${(await call(method, url, token)).status}`);
        }
      }
      const expected = routes().flatMap(([method, url]) =>
        ['owner', 'member', 'outsider', 'API key', 'nobody'].map(who => `${who} ${method} ${url} ${who === 'nobody' ? 401 : 404}`),
      );
      expect(answers).toEqual(expected);
      expect((await dataSource.getRepository(Organization).findOneBy({ id: organization.id })).status).toBe(OrganizationStatus.Active);
      expect(await dataSource.getRepository(OperatorAudit).count()).toBe(0);
    });

    it('answers 404 to an operator whose e-mail is not verified', async () => {
      await dataSource.getRepository(User).update({ id: operator.id }, { emailVerified: false });
      try {
        await request(server()).get('/api/v1/operator/status').set(as(operator)).expect(404);
        await request(server()).get('/api/v1/operator/organizations').set(as(operator)).expect(404);
      } finally {
        await dataSource.getRepository(User).update({ id: operator.id }, { emailVerified: true });
      }
    });

    it('has no operator when the environment names none, not even the built-in fallback address', async () => {
      delete process.env.TR_EVER_ADMIN_EMAILS;
      const adminBefore = process.env.TR_ADMIN_EMAIL;
      delete process.env.TR_ADMIN_EMAIL;
      try {
        expect(operator.email).toBe('local.admin@ever.co');
        await request(server()).get('/api/v1/operator/status').set(as(operator)).expect(404);
        await request(server()).get('/api/v1/operator/organizations').set(as(operator)).expect(404);
        await suspend(organization.id).expect(404);
        // TR_ADMIN_EMAIL alone names the operator too
        process.env.TR_ADMIN_EMAIL = operator.email;
        await request(server()).get('/api/v1/operator/status').set(as(operator)).expect(200);
      } finally {
        process.env.TR_EVER_ADMIN_EMAILS = config.everPlatform.adminEmails[0];
        restoreEnv('TR_ADMIN_EMAIL', adminBefore);
      }
      expect((await dataSource.getRepository(Organization).findOneBy({ id: organization.id })).status).toBe(OrganizationStatus.Active);
    });

    it('answers the operator', async () => {
      const res = await request(server()).get('/api/v1/operator/status').set(as(operator)).expect(200);
      expect(res.body.data).toEqual({ operator: true });
    });
  });

  describe('list and search', () => {
    it('lists every organization, newest first, with its owner and counts, in pages', async () => {
      const res = await request(server()).get('/api/v1/operator/organizations').set(as(operator)).expect(200);
      const names = res.body.data.map(o => o.name);
      // The default organization the migration made, the operator's own and the three of the people above
      expect(res.body.meta).toEqual({ total: 5, page: 1, limit: 25 });
      expect(names).toEqual(expect.arrayContaining(['Outsider organization', 'Member own organization', 'Acme Translations']));
      const created = res.body.data.map(o => new Date(o.date.created).getTime());
      expect(created).toEqual([...created].sort((x, y) => y - x));
      const acme = res.body.data.find(o => o.id === organization.id);
      expect(acme).toHaveExactProperties([
        'id',
        'name',
        'slug',
        'status',
        'planCode',
        'isDefault',
        'owner',
        'membersCount',
        'projectsCount',
        'seatsUsed',
        'stringsUsed',
        'billingCancellation',
        'date',
      ]);
      expect(acme).toMatchObject({
        slug: organization.slug,
        status: 'active',
        planCode: 'starter',
        isDefault: false,
        owner: { userId: owner.id, name: owner.name, email: owner.email },
        membersCount: 2,
        projectsCount: 1,
        stringsUsed: 1,
      });

      const page2 = await request(server()).get('/api/v1/operator/organizations').query({ page: 2, limit: 2 }).set(as(operator)).expect(200);
      expect(page2.body.meta).toEqual({ total: 5, page: 2, limit: 2 });
      expect(page2.body.data.map(o => o.name)).toEqual([names[2], names[3]]);
    });

    it('searches the name, the slug, the owner e-mail and the exact id, and filters by status', async () => {
      const search = async (query: Record<string, string>) =>
        (await request(server()).get('/api/v1/operator/organizations').query(query).set(as(operator)).expect(200)).body.data.map(o => o.name);
      expect(await search({ q: 'ACME trans' })).toEqual(['Acme Translations']);
      expect(await search({ q: organization.slug })).toEqual(['Acme Translations']);
      expect(await search({ q: 'owner-acme@' })).toEqual(['Acme Translations']);
      expect(await search({ q: organization.id })).toEqual(['Acme Translations']);
      // The member's e-mail finds only the organization they own, not the ones they belong to
      expect(await search({ q: 'member-acme' })).toEqual(['Member own organization']);
      expect(await search({ q: 'no such organization' })).toEqual([]);
      // LIKE wildcards in the text are literal: "_" matches only an underscore
      expect(await search({ q: 'owner_acme' })).toEqual([]);
      expect(await search({ q: '%' })).toEqual([]);
      expect(await search({})).toHaveLength(5);
      expect(await search({ status: 'suspended' })).toEqual([]);
      expect(await search({ status: 'active', q: 'outsider' })).toEqual(['Outsider organization']);
    });

    it('refuses a malformed query', async () => {
      for (const query of [{ status: 'gone' }, { page: '0' }, { limit: 'many' }, { q: 'x'.repeat(101) }]) {
        await request(server()).get('/api/v1/operator/organizations').query(query).set(as(operator)).expect(400);
      }
      await request(server()).get('/api/v1/operator/organizations').query({ billing: 'failed' }).set(as(operator)).expect(400);
      await request(server()).get('/api/v1/operator/audit').query({ organizationId: 'not-a-uuid' }).set(as(operator)).expect(400);
      const capped = await request(server()).get('/api/v1/operator/organizations').query({ limit: '5000' }).set(as(operator)).expect(200);
      expect(capped.body.meta.limit).toBe(100);
    });

    it('shows one organization with its effective plan, its usage counted now, and its audit', async () => {
      const res = await request(server()).get(`/api/v1/operator/organizations/${organization.id}`).set(as(operator)).expect(200);
      expect(res.body.data).toMatchObject({
        id: organization.id,
        plan: { code: 'starter', name: 'Starter' },
        usage: { seats: { used: 2, included: 15 }, strings: { used: 1, limit: 10000 } },
        projectsCount: 1,
        audit: [],
      });
      expect(new Date(res.body.data.date.created).getTime()).toBeLessThanOrEqual(Date.now());
      await request(server()).get('/api/v1/operator/organizations/7c7c0a3e-0000-4000-8000-000000000000').set(as(operator)).expect(404);
    });
  });

  describe('suspend and restore', () => {
    const projectCall = (token: string) => request(server()).get(`/api/v1/projects/${projectId}/terms`).set(auth(token));

    it('needs a reason of 3 to 500 characters', async () => {
      await request(server()).post(`/api/v1/operator/organizations/${organization.id}/suspend`).set(as(operator)).send({}).expect(400);
      for (const reason of [null, '', '  ', 'no', ' no ', 42, 'x'.repeat(501)]) {
        await suspend(organization.id, reason).expect(400);
      }
      expect((await dataSource.getRepository(Organization).findOneBy({ id: organization.id })).status).toBe(OrganizationStatus.Active);
      expect(await dataSource.getRepository(OperatorAudit).count()).toBe(0);
    });

    it('locks the members and the API key out at their next request, and lets them back once restored', async () => {
      // Working before
      await projectCall(owner.accessToken).expect(200);
      await projectCall(member.accessToken).expect(200);
      await projectCall(keyToken).expect(200);

      const suspended = await suspend(organization.id, '  Chargeback under review  ').expect(200);
      expect(suspended.body.data.status).toBe('suspended');
      expect(suspended.body.data.audit[0]).toMatchObject({
        action: 'suspend',
        operator: { userId: operator.id, email: operator.email },
        organization: { id: organization.id, name: organization.name, slug: organization.slug },
        reason: 'Chargeback under review',
      });

      for (const token of [owner.accessToken, member.accessToken, keyToken]) {
        const res = await projectCall(token).expect(403);
        expect(res.body.error.code).toBe('organization_suspended');
      }
      const organizationRoute = await request(server()).get(`/api/v1/organizations/${organization.id}`).set(as(member)).expect(403);
      expect(organizationRoute.body.error.code).toBe('organization_suspended');
      await request(server()).post(`/api/v1/projects/${projectId}/terms`).set(as(owner)).send({ value: 'while.suspended' }).expect(403);
      const listed = (await request(server()).get('/api/v1/projects').set(as(member)).expect(200)).body.data.map(p => p.id);
      expect(listed).not.toContain(projectId);

      const restored = await restore(organization.id).expect(200);
      expect(restored.body.data.status).toBe('active');
      expect(restored.body.data.audit.map(row => row.action)).toEqual(['restore', 'suspend']);
      for (const token of [owner.accessToken, member.accessToken, keyToken]) {
        await projectCall(token).expect(200);
      }
    });

    it('refuses a suspension of a suspended or deleted organization and a restore of an active one, writing nothing', async () => {
      const rows = await dataSource.getRepository(OperatorAudit).count();
      const twice = await restore(organization.id).expect(409);
      expect(twice.body.error.code).toBe('organization_status');
      await suspend(organization.id).expect(200);
      expect((await suspend(organization.id).expect(409)).body.error.code).toBe('organization_status');
      await restore(organization.id).expect(200);
      expect(await dataSource.getRepository(OperatorAudit).count()).toBe(rows + 2);

      const closed = (await request(server()).get('/api/v1/organizations').set(as(outsider)).expect(200)).body.data[0];
      await dataSource.getRepository(Organization).update({ id: closed.id }, { status: OrganizationStatus.Deleted });
      try {
        expect((await suspend(closed.id).expect(409)).body.error.code).toBe('organization_status');
        expect((await restore(closed.id).expect(409)).body.error.code).toBe('organization_status');
      } finally {
        await dataSource.getRepository(Organization).update({ id: closed.id }, { status: OrganizationStatus.Active });
      }
      await suspend('7c7c0a3e-0000-4000-8000-000000000000').expect(404);
      expect(await dataSource.getRepository(OperatorAudit).count()).toBe(rows + 2);
    });

    it('never suspends the default organization', async () => {
      const fallback = await dataSource.getRepository(Organization).findOneBy({ isDefault: true });
      const res = await suspend(fallback.id).expect(400);
      expect(res.body.error.code).toBe('default_organization');
      expect((await dataSource.getRepository(Organization).findOneBy({ id: fallback.id })).status).toBe(OrganizationStatus.Active);
    });
  });

  describe('the audit log', () => {
    it('lists every action newest first, with who, what, which organization, why and when, filtered by organization', async () => {
      const all = await request(server()).get('/api/v1/operator/audit').set(as(operator)).expect(200);
      expect(all.body.meta).toEqual({ total: 4, page: 1, limit: 25 });
      expect(all.body.data.map(row => row.action)).toEqual(['restore', 'suspend', 'restore', 'suspend']);
      expect(all.body.data[3]).toHaveExactProperties(['id', 'action', 'operator', 'organization', 'reason', 'date']);
      expect(all.body.data[3].reason).toBe('Chargeback under review');
      const stored = await dataSource.getRepository(OperatorAudit).find();
      expect(
        stored.every(row => row.operatorUserId === operator.id && row.operatorEmail === operator.email && row.organizationId === organization.id),
      ).toBe(true);

      const page = await request(server()).get('/api/v1/operator/audit').query({ limit: 1, page: 4 }).set(as(operator)).expect(200);
      expect(page.body.data.map(row => row.id)).toEqual([all.body.data[3].id]);
      const ofOther = await request(server())
        .get('/api/v1/operator/audit')
        .query({ organizationId: (await request(server()).get('/api/v1/organizations').set(as(outsider))).body.data[0].id })
        .set(as(operator))
        .expect(200);
      expect(ofOther.body).toEqual({ data: [], meta: { total: 0, page: 1, limit: 25 } });
    });

    describe("a deleted organization's address and billing", () => {
      let closed: { id: string; name: string; slug: string };
      const releaseSlug = (id: string) =>
        request(server()).post(`/api/v1/operator/organizations/${id}/release-slug`).set(as(operator)).send({ reason: 'Owner asked for the address' });

      beforeAll(async () => {
        closed = (await request(server()).get('/api/v1/organizations').set(as(outsider)).expect(200)).body.data[0];
        await request(server()).delete(`/api/v1/organizations/${closed.id}`).set(as(outsider)).send({ slug: closed.slug }).expect(204);
      });

      it('shows its billing cancellation, settled at once without billing, and lists nothing unsettled', async () => {
        const detail = (await request(server()).get(`/api/v1/operator/organizations/${closed.id}`).set(as(operator)).expect(200)).body.data;
        expect(detail).toMatchObject({ status: 'deleted', billingCancellation: { status: 'done', attempts: 1, lastError: null } });
        const listed = (await request(server()).get('/api/v1/operator/organizations').set(as(operator)).expect(200)).body.data;
        expect(listed.find(row => row.id === closed.id).billingCancellation).toBe('done');
        expect(listed.find(row => row.id === organization.id).billingCancellation).toBeNull();
        const unsettled = await request(server()).get('/api/v1/operator/organizations').query({ billing: 'unsettled' }).set(as(operator)).expect(200);
        expect(unsettled.body.data).toEqual([]);
        const retry = await request(server())
          .post(`/api/v1/operator/organizations/${closed.id}/billing-cancellation`)
          .set(as(operator))
          .send({ reason: 'Nothing to retry' })
          .expect(409);
        expect(retry.body.error.code).toBe('billing_cancellation_none');
      });

      it('releases its address for another organization, audited, once', async () => {
        const active = await releaseSlug(organization.id).expect(409);
        expect(active.body.error.code).toBe('organization_status');
        // Taken by the tombstone until it is released
        await request(server()).post('/api/v1/organizations').set(as(member)).send({ name: 'Wants the address', slug: closed.slug }).expect(409);

        const released = await releaseSlug(closed.id).expect(200);
        expect(released.body.data.slug).toBe(`deleted-${closed.id.replace(/-/g, '')}`);
        expect(released.body.data.audit[0]).toMatchObject({
          action: 'release_slug',
          reason: 'Owner asked for the address',
          operator: { userId: operator.id },
        });
        expect((await releaseSlug(closed.id).expect(409)).body.error.code).toBe('slug_released');

        const taken = await request(server())
          .post('/api/v1/organizations')
          .set(as(member))
          .send({ name: 'Wants the address', slug: closed.slug })
          .expect(201);
        expect(taken.body.data.slug).toBe(closed.slug);
        // Nobody can take a released address for themselves
        await request(server())
          .post('/api/v1/organizations')
          .set(as(member))
          .send({ name: 'Sneaky', slug: `deleted-${organization.id.replace(/-/g, '')}` })
          .expect(400);
      });
    });

    it('keeps the rows when the operator account goes', async () => {
      const copy = await dataSource.getRepository(OperatorAudit).count();
      const membership = await dataSource.getRepository(OrganizationUser).findOneBy({ userId: operator.id, role: OrganizationRole.Owner });
      expect(membership).toBeTruthy();
      await request(server()).delete('/api/v1/users/me').set(as(operator)).expect(204);
      expect(await dataSource.getRepository(OperatorAudit).count()).toBe(copy);
    });
  });
});

/** Puts an environment variable back as it was (unset when it was) */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

describe('Operator console on a single-tenant install (e2e)', () => {
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

  it('has no operator route, for the operator either', async () => {
    const operator = await signupTestUser(app, config.everPlatform.adminEmails[0]);
    const organizationId = (await request(app.getHttpServer()).get('/api/v1/organizations').set('Authorization', `Bearer ${operator.accessToken}`))
      .body.data[0].id;
    for (const [method, url] of [
      ['GET', '/api/v1/operator/status'],
      ['GET', '/api/v1/operator/organizations'],
      ['GET', `/api/v1/operator/organizations/${organizationId}`],
      ['POST', `/api/v1/operator/organizations/${organizationId}/suspend`],
      ['GET', '/api/v1/operator/audit'],
    ]) {
      const req = request(app.getHttpServer())[method.toLowerCase()](url).set('Authorization', `Bearer ${operator.accessToken}`);
      const res = await (method === 'POST' ? req.send({ reason: 'Single tenant' }) : req);
      expect([url, res.status, res.body.error?.code]).toEqual([url, 404, 'saas_disabled']);
    }
    // Signed out too: the route is not there
    await request(app.getHttpServer()).get('/api/v1/operator/organizations').expect(404);
  });
});
