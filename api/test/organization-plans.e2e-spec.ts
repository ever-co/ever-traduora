import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { config } from '../src/config';
import { OrganizationPlanCode, OrganizationRole } from '../src/domain/organization-actions';
import { OrganizationUser } from '../src/entity/organization-user.entity';
import { Organization } from '../src/entity/organization.entity';
import { Project } from '../src/entity/project.entity';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

/**
 * The plans of DESIGN §3.6 in SaaS mode: seats (members plus pending invitations) and strings (locales × terms over
 * the organization's projects), refused with 402 `plan_limit_reached` past the effective plan's limits, never exceeded
 * by parallel requests, and nothing deleted over the limit (OD-T13). A single-tenant install, and the default
 * organization, keep the per-project plans (§3.5).
 */
interface Org {
  id: string;
  slug: string;
}

const tokenOf = (res: request.Response): string => new URL(res.body.data.inviteUrl).searchParams.get('invite');

describe('Organization plans in SaaS mode (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const saasBefore = config.saasEnabled;

  const server = () => app.getHttpServer();
  const auth = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  const ownOrganizationOf = async (user: TestingUser): Promise<Org> => {
    const organizations = (await request(server()).get('/api/v1/organizations').set(auth(user)).expect(200)).body.data;
    expect(organizations).toHaveLength(1);
    return organizations[0];
  };
  const usageOf = async (user: TestingUser, organizationId: string) =>
    (await request(server()).get(`/api/v1/organizations/${organizationId}/usage`).set(auth(user)).expect(200)).body.data;
  const invite = (owner: TestingUser, organizationId: string, email: string) =>
    request(server()).post(`/api/v1/organizations/${organizationId}/invites`).set(auth(owner)).send({ email, role: 'member' });
  const pendingInvites = async (owner: TestingUser, organizationId: string): Promise<Array<{ id: string; email: string }>> =>
    (await request(server()).get(`/api/v1/organizations/${organizationId}/invites`).set(auth(owner)).expect(200)).body.data;
  const revoke = async (owner: TestingUser, organizationId: string, email: string) => {
    const pending = (await pendingInvites(owner, organizationId)).find(each => each.email === email);
    await request(server()).delete(`/api/v1/organizations/${organizationId}/invites/${pending.id}`).set(auth(owner)).expect(204);
  };
  const projectInvite = (admin: TestingUser, projectId: string, email: string) =>
    request(server()).post(`/api/v1/projects/${projectId}/invites`).set(auth(admin)).send({ email, role: 'editor' });
  const newProject = async (owner: TestingUser, organizationId: string): Promise<string> =>
    (await request(server()).post('/api/v1/projects').set(auth(owner)).send({ name: 'Plans', organizationId }).expect(201)).body.data.id;
  const addLocale = (user: TestingUser, projectId: string, code: string) =>
    request(server()).post(`/api/v1/projects/${projectId}/translations`).set(auth(user)).send({ code });
  const addTerm = (user: TestingUser, projectId: string, value: string) =>
    request(server()).post(`/api/v1/projects/${projectId}/terms`).set(auth(user)).send({ value });
  const importInto = (user: TestingUser, projectId: string, locale: string, content: Record<string, string>) =>
    request(server())
      .post(`/api/v1/projects/${projectId}/imports?locale=${locale}&format=jsonflat`)
      .set(auth(user))
      .attach('file', Buffer.from(JSON.stringify(content)), 'file');
  const counters = async (projectId: string) =>
    dataSource.getRepository(Project).findOneOrFail({ where: { id: projectId }, select: { id: true, localesCount: true, termsCount: true } });
  /** Sets a project's counters without rows: strings that count, quickly (a project as large as the test needs) */
  const setCounters = (projectId: string, localesCount: number, termsCount: number) =>
    dataSource.getRepository(Project).update({ id: projectId }, { localesCount, termsCount });
  const setPlan = (organizationId: string, planCode: OrganizationPlanCode) =>
    dataSource.getRepository(Organization).update({ id: organizationId }, { planCode });
  const expectLimit = (res: request.Response, resource: 'seats' | 'strings', limit: number, used: number, plan = 'starter') => {
    expect([res.status, res.body.error]).toEqual([
      402,
      {
        code: 'plan_limit_reached',
        message: `Your plan allows ${limit} ${resource === 'seats' ? 'members' : 'strings'}. Upgrade to add more.`,
        resource,
        limit,
        used,
        plan,
      },
    ]);
  };
  const statuses = (responses: request.Response[]) => responses.map(res => res.status).sort();

  beforeAll(async () => {
    config.saasEnabled = true;
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    await app.close();
  });

  describe('seats', () => {
    let owner: TestingUser;
    let organization: Org;
    let projectId: string;
    const tokens = new Map<string, string>();

    beforeAll(async () => {
      owner = await signupTestUser(app, 'seats-owner@test.com');
      organization = await ownOrganizationOf(owner);
      projectId = await newProject(owner, organization.id);
    });

    it('start with the owner, on Starter', async () => {
      expect(await usageOf(owner, organization.id)).toEqual({
        plan: { code: 'starter', name: 'Starter' },
        seats: { used: 1, included: 15 },
        strings: { used: 0, limit: 10_000 },
      });
    });

    it('count pending invitations, and refuse the 16th seat', async () => {
      for (let i = 1; i <= 14; i++) {
        const res = await invite(owner, organization.id, `seat-${i}@test.com`).expect(201);
        tokens.set(`seat-${i}@test.com`, tokenOf(res));
      }
      expect((await usageOf(owner, organization.id)).seats).toEqual({ used: 15, included: 15 });

      expectLimit(await invite(owner, organization.id, 'seat-15@test.com'), 'seats', 15, 15);
      // A new link for someone who holds a seat takes no other
      const again = await invite(owner, organization.id, 'seat-1@test.com').expect(201);
      tokens.set('seat-1@test.com', tokenOf(again));
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
      expect(await pendingInvites(owner, organization.id)).toHaveLength(14);
    });

    it('refuse a project invite that brings someone new into a full organization, not one to someone holding a seat', async () => {
      expectLimit(await projectInvite(owner, projectId, 'project-new@test.com'), 'seats', 15, 15);
      // An account with a verified email would join at once: refused too
      const outsider = await signupTestUser(app, 'seats-outsider@test.com');
      expectLimit(await projectInvite(owner, projectId, outsider.email), 'seats', 15, 15);
      // The person of a pending organization invitation already holds their seat
      await projectInvite(owner, projectId, 'seat-2@test.com').expect(201);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
    });

    it('are freed by a revoked invitation, and taken by a pending project invitation', async () => {
      await revoke(owner, organization.id, 'seat-14@test.com');
      expect((await usageOf(owner, organization.id)).seats.used).toBe(14);

      const pending = await projectInvite(owner, projectId, 'project-new@test.com').expect(201);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
      expectLimit(await invite(owner, organization.id, 'seat-14@test.com'), 'seats', 15, 15);

      await request(server()).delete(`/api/v1/projects/${projectId}/invites/${pending.body.data.id}`).set(auth(owner)).expect(204);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(14);
      const back = await invite(owner, organization.id, 'seat-14@test.com').expect(201);
      tokens.set('seat-14@test.com', tokenOf(back));
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
    });

    it('let an invited person join at the limit: the seat they held becomes theirs', async () => {
      const res = await request(server())
        .post('/api/v1/auth/signup')
        .send({ name: 'Seat 3', email: 'seat-3@test.com', password: 'mysupersecretpassword', inviteToken: tokens.get('seat-3@test.com') })
        .expect(200);
      const joined = res.body.data as TestingUser;
      expect((await request(server()).get('/api/v1/organizations').set(auth(joined)).expect(200)).body.data.map(each => each.id)).toEqual([
        organization.id,
      ]);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
    });

    it('are never exceeded by parallel invitations', async () => {
      await revoke(owner, organization.id, 'seat-13@test.com');
      await revoke(owner, organization.id, 'seat-12@test.com');
      expect((await usageOf(owner, organization.id)).seats.used).toBe(13);

      const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => invite(owner, organization.id, `parallel-${i}@test.com`)));
      expect(statuses(responses)).toEqual([201, 201, 402, 402, 402, 402]);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
    });

    it('are never exceeded by parallel project invitations', async () => {
      await revoke(owner, organization.id, (await pendingInvites(owner, organization.id)).find(each => each.email.startsWith('parallel-')).email);
      const responses = await Promise.all(Array.from({ length: 4 }, (_, i) => projectInvite(owner, projectId, `project-parallel-${i}@test.com`)));
      expect(statuses(responses)).toEqual([201, 402, 402, 402]);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
    });

    describe('over the limit after a downgrade (OD-T13)', () => {
      let late: TestingUser;
      let lateToken: string;
      let projectLate: TestingUser;
      let projectLateToken: string;
      let membersBefore: number;

      beforeAll(async () => {
        // Accounts without a verified email get an invitation, as anyone new does
        late = await signupTestUser(app, 'late@test.com', false);
        projectLate = await signupTestUser(app, 'project-late@test.com', false);
        await setPlan(organization.id, OrganizationPlanCode.SmallBusiness);
        lateToken = tokenOf(await invite(owner, organization.id, late.email).expect(201));
        await invite(owner, organization.id, 'late-signup@test.com').expect(201);
        tokens.set('late-signup@test.com', tokenOf(await invite(owner, organization.id, 'late-signup@test.com').expect(201)));
        projectLateToken = tokenOf(await projectInvite(owner, projectId, projectLate.email).expect(201));
        expect((await usageOf(owner, organization.id)).seats).toEqual({ used: 18, included: 25 });
        membersBefore = (await request(server()).get(`/api/v1/organizations/${organization.id}/members`).set(auth(owner)).expect(200)).body.data
          .length;
        await setPlan(organization.id, OrganizationPlanCode.Starter);
      });

      it('keeps everyone and every invitation, and reads keep working', async () => {
        expect(await usageOf(owner, organization.id)).toMatchObject({ plan: { code: 'starter' }, seats: { used: 18, included: 15 } });
        const members = await request(server()).get(`/api/v1/organizations/${organization.id}/members`).set(auth(owner)).expect(200);
        expect(members.body.data).toHaveLength(membersBefore);
        expect((await pendingInvites(owner, organization.id)).map(each => each.email)).toEqual(
          expect.arrayContaining([late.email, 'late-signup@test.com']),
        );
        await request(server()).get(`/api/v1/projects/${projectId}`).set(auth(owner)).expect(200);
      });

      it('refuses new invitations', async () => {
        expectLimit(await invite(owner, organization.id, 'one-more@test.com'), 'seats', 15, 18);
        expectLimit(await projectInvite(owner, projectId, 'one-more@test.com'), 'seats', 15, 18);
      });

      it('refuses an acceptance, and the invitation stays pending', async () => {
        expectLimit(
          await request(server()).post('/api/v1/auth/accept-organization-invite').set(auth(late)).send({ inviteToken: lateToken }),
          'seats',
          15,
          18,
        );
        expectLimit(
          await request(server()).post('/api/v1/auth/accept-invite').set(auth(projectLate)).send({ inviteToken: projectLateToken }),
          'seats',
          15,
          18,
        );
        expect((await pendingInvites(owner, organization.id)).map(each => each.email)).toContain(late.email);
        await request(server()).get(`/api/v1/organizations/${organization.id}`).set(auth(late)).expect(404);
        await request(server()).get(`/api/v1/projects/${projectId}`).set(auth(projectLate)).expect(404);
      });

      it('still makes the account of a sign-up with an invitation, in its own organization', async () => {
        const res = await request(server())
          .post('/api/v1/auth/signup')
          .send({
            name: 'Late signup',
            email: 'late-signup@test.com',
            password: 'mysupersecretpassword',
            inviteToken: tokens.get('late-signup@test.com'),
          })
          .expect(200);
        const own = await ownOrganizationOf(res.body.data);
        expect(own.id).not.toBe(organization.id);
        expect((await pendingInvites(owner, organization.id)).map(each => each.email)).toContain('late-signup@test.com');
      });

      it('accepts again once the organization is back within its seats', async () => {
        for (const email of ['seat-4@test.com', 'seat-5@test.com', 'seat-6@test.com']) {
          await revoke(owner, organization.id, email);
        }
        expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
        await request(server()).post('/api/v1/auth/accept-organization-invite').set(auth(late)).send({ inviteToken: lateToken }).expect(200);
        expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
        await request(server()).get(`/api/v1/organizations/${organization.id}`).set(auth(late)).expect(200);
      });
    });
  });

  describe('strings', () => {
    let owner: TestingUser;
    let organization: Org;
    let projectId: string;
    let ballastId: string;

    beforeAll(async () => {
      owner = await signupTestUser(app, 'strings-owner@test.com');
      organization = await ownOrganizationOf(owner);
      projectId = await newProject(owner, organization.id);
      ballastId = await newProject(owner, organization.id);
      await addLocale(owner, projectId, 'de').expect(201);
      await setCounters(ballastId, 1, 9_990);
    });

    it('count locales × terms over every project of the organization', async () => {
      expect((await usageOf(owner, organization.id)).strings).toEqual({ used: 9_990, limit: 10_000 });
    });

    it('take terms up to the limit, then refuse', async () => {
      for (let i = 0; i < 10; i++) {
        await addTerm(owner, projectId, `term.${i}`).expect(201);
      }
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_000);
      expectLimit(await addTerm(owner, projectId, 'term.over'), 'strings', 10_000, 10_000);
      expect(await counters(projectId)).toMatchObject({ localesCount: 1, termsCount: 10 });
    });

    it('take a term that adds no string (no locale yet), and refuse a locale that adds strings', async () => {
      const empty = await newProject(owner, organization.id);
      await addTerm(owner, empty, 'lonely').expect(201);
      expectLimit(await addLocale(owner, empty, 'fr'), 'strings', 10_000, 10_000);
      expect(await counters(empty)).toMatchObject({ localesCount: 0, termsCount: 1 });
    });

    it('refuse an import that adds strings, and write nothing; an import of existing terms still works', async () => {
      expectLimit(await importInto(owner, projectId, 'de', { 'new.one': 'eins', 'new.two': 'zwei' }), 'strings', 10_000, 10_000);
      expectLimit(await importInto(owner, projectId, 'fr', { 'term.0': 'zéro' }), 'strings', 10_000, 10_000);
      expect(await counters(projectId)).toMatchObject({ localesCount: 1, termsCount: 10 });
      const terms = await request(server()).get(`/api/v1/projects/${projectId}/terms`).set(auth(owner)).expect(200);
      expect(terms.body.data).toHaveLength(10);

      const edit = await importInto(owner, projectId, 'de', { 'term.0': 'null', 'term.1': 'eins' }).expect(200);
      expect(edit.body.data.terms).toEqual({ added: 0, skipped: 2 });
    });

    it('keep reads, edits and exports working over the limit', async () => {
      await setCounters(ballastId, 1, 10_500);
      expect((await usageOf(owner, organization.id)).strings).toEqual({ used: 10_510, limit: 10_000 });
      const terms = (await request(server()).get(`/api/v1/projects/${projectId}/terms`).set(auth(owner)).expect(200)).body.data;
      await request(server()).get(`/api/v1/projects/${projectId}/translations/de`).set(auth(owner)).expect(200);
      await request(server())
        .patch(`/api/v1/projects/${projectId}/translations/de`)
        .set(auth(owner))
        .send({ termId: terms[0].id, value: 'geändert' })
        .expect(200);
      await request(server()).get(`/api/v1/projects/${projectId}/exports?locale=de&format=jsonflat`).set(auth(owner)).expect(200);
      expectLimit(await addTerm(owner, projectId, 'term.over'), 'strings', 10_000, 10_510);
      // Removing is fine, and brings the organization back down
      await request(server()).delete(`/api/v1/projects/${projectId}/terms/${terms[9].id}`).set(auth(owner)).expect(204);
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_509);
    });

    it('are never exceeded by parallel adds', async () => {
      const own = await counters(projectId);
      // Three strings left: three of the terms fit
      await setCounters(ballastId, 1, 10_000 - own.localesCount * own.termsCount - 3);
      const responses = await Promise.all(Array.from({ length: 8 }, (_, i) => addTerm(owner, projectId, `parallel.${i}`)));
      expect(statuses(responses)).toEqual([201, 201, 201, 402, 402, 402, 402, 402]);
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_000);
    });

    it('are never exceeded by parallel imports', async () => {
      const own = await counters(projectId);
      await setCounters(ballastId, 1, 10_000 - own.localesCount * own.termsCount - 2);
      const responses = await Promise.all(
        Array.from({ length: 4 }, (_, i) => importInto(owner, projectId, 'de', { [`import.${i}.a`]: 'a', [`import.${i}.b`]: 'b' })),
      );
      expect(statuses(responses)).toEqual([200, 402, 402, 402]);
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_000);
    });

    it('have no limit on Small Business and Enterprise, and the project plans stay ignored', async () => {
      await setPlan(organization.id, OrganizationPlanCode.SmallBusiness);
      expect(await usageOf(owner, organization.id)).toEqual({
        plan: { code: 'small_business', name: 'Small Business' },
        seats: { used: 1, included: 25 },
        strings: { used: 10_000, limit: null },
      });
      // Far past the project plan of the e2e install (100 strings), which an organization's project does not use
      await setCounters(projectId, 1, 500);
      await addTerm(owner, projectId, 'unlimited').expect(201);
      await addLocale(owner, projectId, 'fr').expect(201);

      await setPlan(organization.id, OrganizationPlanCode.Enterprise);
      expect((await usageOf(owner, organization.id)).seats).toEqual({ used: 1, included: null });
    });
  });

  describe('usage', () => {
    it('answers the owner and the admins only', async () => {
      const owner = await signupTestUser(app, 'usage-owner@test.com');
      const admin = await signupTestUser(app, 'usage-admin@test.com');
      const member = await signupTestUser(app, 'usage-member@test.com');
      const outsider = await signupTestUser(app, 'usage-outsider@test.com');
      const organization = await ownOrganizationOf(owner);
      await request(server())
        .post(`/api/v1/organizations/${organization.id}/invites`)
        .set(auth(owner))
        .send({ email: admin.email, role: 'admin' })
        .expect(201);
      await invite(owner, organization.id, member.email).expect(201);

      expect((await usageOf(admin, organization.id)).seats.used).toBe(3);
      await request(server()).get(`/api/v1/organizations/${organization.id}/usage`).set(auth(member)).expect(404);
      await request(server()).get(`/api/v1/organizations/${organization.id}/usage`).set(auth(outsider)).expect(404);
      await request(server()).get(`/api/v1/organizations/${organization.id}/usage`).expect(401);
    });
  });

  describe('the default organization', () => {
    it('keeps the plans of its projects, with no organization limit', async () => {
      const user = await signupTestUser(app, 'default-org@test.com');
      const own = await ownOrganizationOf(user);
      const projectId = await newProject(user, own.id);
      const defaultOrganization = await dataSource.getRepository(Organization).findOneByOrFail({ isDefault: true });
      // A project of an upgraded install, in the default organization
      await dataSource
        .getRepository(OrganizationUser)
        .save({ organizationId: defaultOrganization.id, userId: user.id, role: OrganizationRole.Admin });
      await dataSource.getRepository(Project).update({ id: projectId }, { organizationId: defaultOrganization.id });
      await addLocale(user, projectId, 'de').expect(201);
      await setCounters(projectId, 1, 99);

      await addTerm(user, projectId, 'within').expect(201);
      const refused = await addTerm(user, projectId, 'past').expect(402);
      expect(refused.body.error.code).toBe('PaymentRequired');
      await request(server()).get(`/api/v1/organizations/${defaultOrganization.id}/usage`).set(auth(user)).expect(404);
    });
  });
});

describe('Organization plans in single-tenant mode (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const saasBefore = config.saasEnabled;
  const server = () => app.getHttpServer();
  const auth = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });

  beforeAll(async () => {
    config.saasEnabled = false;
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    await app.close();
  });

  it('keeps the per-project plan exactly, with no seats and no usage route', async () => {
    const user = await signupTestUser(app, 'single-tenant@test.com');
    const projectId = (await request(server()).post('/api/v1/projects').set(auth(user)).send({ name: 'Single' }).expect(201)).body.data.id;
    await request(server()).post(`/api/v1/projects/${projectId}/translations`).set(auth(user)).send({ code: 'de' }).expect(201);
    await dataSource.getRepository(Project).update({ id: projectId }, { localesCount: 1, termsCount: 99 });

    await request(server()).post(`/api/v1/projects/${projectId}/terms`).set(auth(user)).send({ value: 'within' }).expect(201);
    const refused = await request(server()).post(`/api/v1/projects/${projectId}/terms`).set(auth(user)).send({ value: 'past' }).expect(402);
    expect(refused.body.error).toEqual({ code: 'PaymentRequired', message: 'You seem to have reached your plan limit' });

    // No seats: more people than Starter's seats are invited, and no counter of the default organization is kept
    const defaultOrganization = () => dataSource.getRepository(Organization).findOneByOrFail({ isDefault: true });
    const countersBefore = await defaultOrganization();
    for (let i = 0; i < 17; i++) {
      await request(server())
        .post(`/api/v1/projects/${projectId}/invites`)
        .set(auth(user))
        .send({ email: `single-${i}@test.com`, role: 'viewer' })
        .expect(201);
    }

    const countersAfter = await defaultOrganization();
    expect([countersAfter.seatsUsed, countersAfter.stringsUsed]).toEqual([countersBefore.seatsUsed, countersBefore.stringsUsed]);

    const organizations = (await request(server()).get('/api/v1/organizations').set(auth(user)).expect(200)).body.data;
    const usage = await request(server()).get(`/api/v1/organizations/${organizations[0].id}/usage`).set(auth(user)).expect(404);
    expect(usage.body.error.code).toBe('saas_disabled');
  });
});
