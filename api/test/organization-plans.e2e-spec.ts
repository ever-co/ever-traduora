import { INestApplication } from '@nestjs/common';
import { Agent } from 'http';
import { AddressInfo } from 'net';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { config } from '../src/config';
import { OrganizationPlanCode, OrganizationRole } from '../src/domain/organization-actions';
import { OrganizationUser } from '../src/entity/organization-user.entity';
import { Organization } from '../src/entity/organization.entity';
import { Project } from '../src/entity/project.entity';
import { Invite } from '../src/entity/invite.entity';
import { User } from '../src/entity/user.entity';
import { ProjectRole } from '../src/entity/project-user.entity';
import { createAndMigrateApp, createTestProjectClient, signupTestUser, TestingProject, TestingUser, currentTerms } from './util';

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
  /**
   * Every request of this suite goes to one listener (`app.listen(0)`), through one keep-alive agent (10 sockets, as
   * many as the largest burst): supertest on an
   * unlistened server opens a listener per request, and a burst of parallel ones could drop a connection under load.
   * The agent closes an idle socket (10 s) before the server would (30 s), so a reused socket is never one the server
   * is closing.
   */
  let base: string;
  const agent = new Agent({ keepAlive: true, maxSockets: 10, timeout: 10_000 });
  const call = (method: 'get' | 'post' | 'patch' | 'delete', path: string) => request(base)[method](path).agent(agent);
  const auth = (user: TestingUser) => ({ Authorization: `Bearer ${user.accessToken}` });
  /** Marks the account's e-mail as confirmed (SaaS mode opens nothing else before), without the acceptances its link makes */
  const confirmEmail = async <T extends { id: string }>(user: T): Promise<T> => {
    await dataSource.getRepository(User).update({ id: user.id }, { emailVerified: true });
    return user;
  };
  const ownOrganizationOf = async (user: TestingUser): Promise<Org> => {
    const organizations = (await call('get', '/api/v1/organizations').set(auth(user)).expect(200)).body.data;
    expect(organizations).toHaveLength(1);
    return organizations[0];
  };
  const usageOf = async (user: TestingUser, organizationId: string) =>
    (await call('get', `/api/v1/organizations/${organizationId}/usage`).set(auth(user)).expect(200)).body.data;
  const invite = (owner: TestingUser, organizationId: string, email: string) =>
    call('post', `/api/v1/organizations/${organizationId}/invites`).set(auth(owner)).send({ email, role: 'member' });
  const pendingInvites = async (owner: TestingUser, organizationId: string): Promise<Array<{ id: string; email: string }>> =>
    (await call('get', `/api/v1/organizations/${organizationId}/invites`).set(auth(owner)).expect(200)).body.data;
  const revoke = async (owner: TestingUser, organizationId: string, email: string) => {
    const pending = (await pendingInvites(owner, organizationId)).find(each => each.email === email);
    await call('delete', `/api/v1/organizations/${organizationId}/invites/${pending.id}`).set(auth(owner)).expect(204);
  };
  const projectInvite = (admin: TestingUser, projectId: string, email: string) =>
    call('post', `/api/v1/projects/${projectId}/invites`).set(auth(admin)).send({ email, role: 'editor' });
  const newProject = async (owner: TestingUser, organizationId: string): Promise<string> =>
    (await call('post', '/api/v1/projects').set(auth(owner)).send({ name: 'Plans', organizationId }).expect(201)).body.data.id;
  const addLocale = (user: TestingUser, projectId: string, code: string) =>
    call('post', `/api/v1/projects/${projectId}/translations`).set(auth(user)).send({ code });
  const addTerm = (user: TestingUser, projectId: string, value: string) =>
    call('post', `/api/v1/projects/${projectId}/terms`).set(auth(user)).send({ value });
  const importInto = (user: TestingUser, projectId: string, locale: string, content: Record<string, string>) =>
    call('post', `/api/v1/projects/${projectId}/imports?locale=${locale}&format=jsonflat`)
      .set(auth(user))
      .attach('file', Buffer.from(JSON.stringify(content)), 'file');
  const counters = async (projectId: string) =>
    dataSource.getRepository(Project).findOneOrFail({ where: { id: projectId }, select: { id: true, localesCount: true, termsCount: true } });
  /** Sets a project's counters without rows: strings that count, quickly (a project as large as the test needs) */
  const setCounters = (projectId: string, localesCount: number, termsCount: number) =>
    dataSource.getRepository(Project).update({ id: projectId }, { localesCount, termsCount });
  const setPlan = (organizationId: string, planCode: OrganizationPlanCode) =>
    dataSource.getRepository(Organization).update({ id: organizationId }, { planCode });
  /** A refusal of the plan; `used` is `null` for a caller who may not read the organization's usage (no used, no plan) */
  const expectLimit = (res: request.Response, resource: 'seats' | 'strings', limit: number, used: number | null, plan = 'starter') => {
    expect([res.status, res.body.error]).toEqual([
      402,
      {
        code: 'plan_limit_reached',
        message: `Your plan allows ${limit} ${resource === 'seats' ? 'members' : 'strings'}. Upgrade to add more.`,
        resource,
        limit,
        ...(used === null ? {} : { used, plan }),
      },
    ]);
  };

  /**
   * Sends the requests at once and answers their statuses, sorted. A request that gets no answer (a dropped connection)
   * fails the test here, with what happened, instead of showing up as a wrong count in the tests after it.
   */
  const atOnce = async (label: string, requests: Array<() => request.Test>): Promise<number[]> => {
    const settled = await Promise.allSettled(requests.map(send => send()));
    const failed = settled
      .map((result, index) => (result.status === 'rejected' ? `#${index}: ${result.reason?.code ?? ''} ${result.reason?.message}` : null))
      .filter(Boolean);
    if (failed.length) {
      throw new Error(`${label}: ${failed.length} of ${requests.length} parallel requests got no answer (${failed.join('; ')})`);
    }
    return settled.map(result => (result as PromiseFulfilledResult<request.Response>).value.status).sort((a, b) => a - b);
  };
  /** A new organization whose owner signs up, with `seats` seats taken: the owner and pending invitations */
  const organizationWithSeats = async (label: string, seats: number) => {
    const owner = await signupTestUser(app, `${label}-owner@test.com`);
    const organization = await ownOrganizationOf(owner);
    for (let i = 1; i < seats; i++) {
      await invite(owner, organization.id, `${label}-${i}@test.com`).expect(201);
    }
    expect((await usageOf(owner, organization.id)).seats.used).toBe(seats);
    return { owner, organization };
  };
  /** A new organization with a project in German, and `left` strings left before Starter's limit (a ballast project) */
  const organizationWithStringsLeft = async (label: string, left: number) => {
    const owner = await signupTestUser(app, `${label}-owner@test.com`);
    const organization = await ownOrganizationOf(owner);
    const projectId = await newProject(owner, organization.id);
    await addLocale(owner, projectId, 'de').expect(201);
    await setCounters(await newProject(owner, organization.id), 1, 10_000 - left);
    expect((await usageOf(owner, organization.id)).strings.used).toBe(10_000 - left);
    return { owner, organization, projectId };
  };

  beforeAll(async () => {
    config.saasEnabled = true;
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer();
    server.keepAliveTimeout = 30_000;
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    config.saasEnabled = saasBefore;
    agent.destroy();
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

      await call('delete', `/api/v1/projects/${projectId}/invites/${pending.body.data.id}`).set(auth(owner)).expect(204);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(14);
      const back = await invite(owner, organization.id, 'seat-14@test.com').expect(201);
      tokens.set('seat-14@test.com', tokenOf(back));
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
    });

    it('let an invited person join at the limit: the seat they held becomes theirs', async () => {
      // Its own organization, full with the invitation it accepts: 14 seats, then the joiner's pending one
      const full = await organizationWithSeats('join', 14);
      const token = tokenOf(await invite(full.owner, full.organization.id, 'join-new@test.com').expect(201));
      expect((await usageOf(full.owner, full.organization.id)).seats).toEqual({ used: 15, included: 15 });
      const res = await call('post', '/api/v1/auth/signup')
        .send({ name: 'Joiner', email: 'join-new@test.com', password: 'mysupersecretpassword', ...currentTerms(), inviteToken: token })
        .expect(200);
      const joined = await confirmEmail(res.body.data as TestingUser);
      expect((await call('get', '/api/v1/organizations').set(auth(joined)).expect(200)).body.data.map(each => each.id)).toEqual([
        full.organization.id,
      ]);
      expect((await usageOf(full.owner, full.organization.id)).seats.used).toBe(15);
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

    it('tell an editor and an API key what the plan allows, not what the organization uses', async () => {
      const editor = await signupTestUser(app, 'strings-editor@test.com');
      await call('post', `/api/v1/projects/${projectId}/invites`).set(auth(owner)).send({ email: editor.email, role: 'editor' }).expect(201);
      expectLimit(await addTerm(editor, projectId, 'term.editor'), 'strings', 10_000, null);
      const client = await createTestProjectClient(app, owner, { id: projectId } as TestingProject, ProjectRole.Editor);
      const byKey = await call('post', `/api/v1/projects/${projectId}/terms`)
        .set('Authorization', `Bearer ${client.accessToken}`)
        .send({ value: 'term.client' });
      expectLimit(byKey, 'strings', 10_000, null);
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
      const terms = await call('get', `/api/v1/projects/${projectId}/terms`).set(auth(owner)).expect(200);
      expect(terms.body.data).toHaveLength(10);

      const edit = await importInto(owner, projectId, 'de', { 'term.0': 'null', 'term.1': 'eins' }).expect(200);
      expect(edit.body.data.terms).toEqual({ added: 0, skipped: 2 });
    });

    it('keep reads, edits and exports working over the limit', async () => {
      await setCounters(ballastId, 1, 10_500);
      expect((await usageOf(owner, organization.id)).strings).toEqual({ used: 10_510, limit: 10_000 });
      const terms = (await call('get', `/api/v1/projects/${projectId}/terms`).set(auth(owner)).expect(200)).body.data;
      await call('get', `/api/v1/projects/${projectId}/translations/de`).set(auth(owner)).expect(200);
      await call('patch', `/api/v1/projects/${projectId}/translations/de`)
        .set(auth(owner))
        .send({ termId: terms[0].id, value: 'geändert' })
        .expect(200);
      await call('get', `/api/v1/projects/${projectId}/exports?locale=de&format=jsonflat`).set(auth(owner)).expect(200);
      expectLimit(await addTerm(owner, projectId, 'term.over'), 'strings', 10_000, 10_510);
      // Removing is fine, and brings the organization back down
      await call('delete', `/api/v1/projects/${projectId}/terms/${terms[9].id}`).set(auth(owner)).expect(204);
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_509);
    });
  });

  describe('limits under parallel requests (each test with its own organization)', () => {
    it('never let parallel invitations exceed the seats', async () => {
      const { owner, organization } = await organizationWithSeats('parallel-invites', 13);
      const statuses = await atOnce(
        'invitations',
        Array.from({ length: 6 }, (_, i) => () => invite(owner, organization.id, `parallel-invites-new-${i}@test.com`)),
      );
      expect(statuses).toEqual([201, 201, 402, 402, 402, 402]);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
    });

    it('never let parallel project invitations exceed the seats', async () => {
      const { owner, organization } = await organizationWithSeats('parallel-project-invites', 14);
      const projectId = await newProject(owner, organization.id);
      const statuses = await atOnce(
        'project invitations',
        Array.from({ length: 4 }, (_, i) => () => projectInvite(owner, projectId, `parallel-project-invites-new-${i}@test.com`)),
      );
      expect(statuses).toEqual([201, 402, 402, 402]);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
    });

    it('never let parallel term adds exceed the strings', async () => {
      // Three strings left: three of the eight terms fit (one locale)
      const { owner, organization, projectId } = await organizationWithStringsLeft('parallel-terms', 3);
      const statuses = await atOnce(
        'term adds',
        Array.from({ length: 8 }, (_, i) => () => addTerm(owner, projectId, `parallel.${i}`)),
      );
      expect(statuses).toEqual([201, 201, 201, 402, 402, 402, 402, 402]);
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_000);
    });

    it('never let parallel adds in different projects of one organization exceed its strings', async () => {
      // Three projects in German and three strings left for the organization. The project locks do not order requests
      // to different projects: only the organization's lock does. A term in A or B costs one string, an import of two
      // new terms into B two, the French locale of C (two terms) two.
      const owner = await signupTestUser(app, 'cross-projects-owner@test.com');
      const organization = await ownOrganizationOf(owner);
      const projects = [await newProject(owner, organization.id), await newProject(owner, organization.id), await newProject(owner, organization.id)];
      const [a, b, c] = projects;
      for (const projectId of projects) {
        await addLocale(owner, projectId, 'de').expect(201);
      }
      await addTerm(owner, c, 'c.one').expect(201);
      await addTerm(owner, c, 'c.two').expect(201);
      await setCounters(await newProject(owner, organization.id), 1, 10_000 - 3 - 2);
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_000 - 3);
      const stringsOf = (project: { localesCount: number; termsCount: number }) => project.localesCount * project.termsCount;
      const before = await Promise.all(projects.map(counters));

      const statuses = await atOnce('adds across projects', [
        ...[0, 1, 2].map(i => () => addTerm(owner, a, `a.${i}`)),
        ...[0, 1, 2].map(i => () => addTerm(owner, b, `b.${i}`)),
        ...[0, 1].map(i => () => importInto(owner, b, 'de', { [`b.import.${i}.one`]: 'x', [`b.import.${i}.two`]: 'y' })),
        () => addLocale(owner, c, 'fr'),
      ]);

      // Whatever the order, six one-string terms fill what is left: the organization ends exactly at its limit, and what
      // went through added three strings across the projects, never more
      expect(statuses.every(status => [200, 201, 402].includes(status))).toBe(true);
      expect(statuses.filter(status => status === 402).length).toBeGreaterThanOrEqual(6);
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_000);
      const after = await Promise.all(projects.map(counters));
      expect(after.reduce((sum, project, i) => sum + stringsOf(project) - stringsOf(before[i]), 0)).toBe(3);
    });

    it('never let parallel imports exceed the strings', async () => {
      // Two strings left: one import of two new terms fits
      const { owner, organization, projectId } = await organizationWithStringsLeft('parallel-imports', 2);
      const statuses = await atOnce(
        'imports',
        Array.from({ length: 4 }, (_, i) => () => importInto(owner, projectId, 'de', { [`import.${i}.a`]: 'a', [`import.${i}.b`]: 'b' })),
      );
      expect(statuses).toEqual([200, 402, 402, 402]);
      expect((await usageOf(owner, organization.id)).strings.used).toBe(10_000);
    });
  });

  describe('over the limit after a downgrade (OD-T13)', () => {
    let owner: TestingUser;
    let organization: Org;
    let projectId: string;
    let late: TestingUser;
    let lateToken: string;
    let projectLate: TestingUser;
    let projectLateToken: string;
    let signupToken: string;
    /** Pending invitations that only fill seats */
    const fillers = 14;
    /** The owner, the fillers, and three people invited while on Small Business */
    const seats = 1 + fillers + 3;

    beforeAll(async () => {
      owner = await signupTestUser(app, 'downgrade-owner@test.com');
      organization = await ownOrganizationOf(owner);
      projectId = await newProject(owner, organization.id);
      // Accounts without a verified email get an invitation, as anyone new does
      late = await signupTestUser(app, 'downgrade-late@test.com', false);
      projectLate = await signupTestUser(app, 'downgrade-project-late@test.com', false);
      await setPlan(organization.id, OrganizationPlanCode.SmallBusiness);
      for (let i = 1; i <= fillers; i++) {
        await invite(owner, organization.id, `downgrade-${i}@test.com`).expect(201);
      }
      lateToken = tokenOf(await invite(owner, organization.id, late.email).expect(201));
      signupToken = tokenOf(await invite(owner, organization.id, 'downgrade-signup@test.com').expect(201));
      projectLateToken = tokenOf(await projectInvite(owner, projectId, projectLate.email).expect(201));
      // Invited while unconfirmed, confirmed before they accept
      await confirmEmail(late);
      await confirmEmail(projectLate);
      expect((await usageOf(owner, organization.id)).seats).toEqual({ used: seats, included: 25 });
      await setPlan(organization.id, OrganizationPlanCode.Starter);
    });

    it('keeps everyone and every invitation, and reads keep working', async () => {
      expect(await usageOf(owner, organization.id)).toMatchObject({ plan: { code: 'starter' }, seats: { used: seats, included: 15 } });
      const members = await call('get', `/api/v1/organizations/${organization.id}/members`).set(auth(owner)).expect(200);
      expect(members.body.data.map(member => member.email)).toEqual([owner.email]);
      const pending = (await pendingInvites(owner, organization.id)).map(each => each.email);
      expect(pending).toHaveLength(fillers + 2);
      expect(pending).toEqual(expect.arrayContaining([late.email, 'downgrade-signup@test.com']));
      await call('get', `/api/v1/projects/${projectId}`).set(auth(owner)).expect(200);
    });

    it('refuses new invitations', async () => {
      expectLimit(await invite(owner, organization.id, 'downgrade-one-more@test.com'), 'seats', 15, seats);
      expectLimit(await projectInvite(owner, projectId, 'downgrade-one-more@test.com'), 'seats', 15, seats);
    });

    it('refuses an acceptance, and the invitation stays pending', async () => {
      expectLimit(
        await call('post', '/api/v1/auth/accept-organization-invite').set(auth(late)).send({ inviteToken: lateToken }),
        'seats',
        15,
        // An invitee may not read the organization's usage: what the plan allows, nothing more
        null,
      );
      expectLimit(await call('post', '/api/v1/auth/accept-invite').set(auth(projectLate)).send({ inviteToken: projectLateToken }), 'seats', 15, null);
      expect((await pendingInvites(owner, organization.id)).map(each => each.email)).toContain(late.email);
      await call('get', `/api/v1/organizations/${organization.id}`).set(auth(late)).expect(404);
      await call('get', `/api/v1/projects/${projectId}`).set(auth(projectLate)).expect(404);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(seats);
    });

    it('still makes the account of a sign-up with an invitation, in its own organization', async () => {
      const res = await call('post', '/api/v1/auth/signup')
        .send({
          name: 'Downgrade signup',
          email: 'downgrade-signup@test.com',
          password: 'mysupersecretpassword',
          ...currentTerms(),
          inviteToken: signupToken,
        })
        .expect(200);
      const own = await ownOrganizationOf(await confirmEmail(res.body.data));
      expect(own.id).not.toBe(organization.id);
      expect((await pendingInvites(owner, organization.id)).map(each => each.email)).toContain('downgrade-signup@test.com');
      expect((await usageOf(owner, organization.id)).seats.used).toBe(seats);
    });

    it('accepts again once the organization is back within its seats', async () => {
      for (let i = 1; i <= seats - 15; i++) {
        await revoke(owner, organization.id, `downgrade-${i}@test.com`);
      }
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
      await call('post', '/api/v1/auth/accept-organization-invite').set(auth(late)).send({ inviteToken: lateToken }).expect(200);
      expect((await usageOf(owner, organization.id)).seats.used).toBe(15);
      await call('get', `/api/v1/organizations/${organization.id}`).set(auth(late)).expect(200);
    });
  });

  describe('plans without limits', () => {
    it('have no strings limit on Small Business and Enterprise, and the project plans stay ignored', async () => {
      const owner = await signupTestUser(app, 'unlimited-owner@test.com');
      const organization = await ownOrganizationOf(owner);
      const projectId = await newProject(owner, organization.id);
      await addLocale(owner, projectId, 'de').expect(201);
      await setPlan(organization.id, OrganizationPlanCode.SmallBusiness);
      // Far past Starter's strings, and the project plan of the e2e install (100 strings), which it does not use
      await setCounters(projectId, 1, 12_000);
      expect(await usageOf(owner, organization.id)).toEqual({
        plan: { code: 'small_business', name: 'Small Business' },
        seats: { used: 1, included: 25 },
        strings: { used: 12_000, limit: null },
      });
      await addTerm(owner, projectId, 'unlimited').expect(201);
      await addLocale(owner, projectId, 'fr').expect(201);

      await setPlan(organization.id, OrganizationPlanCode.Enterprise);
      expect((await usageOf(owner, organization.id)).seats).toEqual({ used: 1, included: null });
    });
  });

  describe('the cached counters', () => {
    let owner: TestingUser;
    let organization: Org;

    /** The counters stored on the organization, which P4's billing reads, against the live usage */
    const expectCountersMatch = async (seats: number, strings: number) => {
      const stored = await dataSource.getRepository(Organization).findOneByOrFail({ id: organization.id });
      const usage = await usageOf(owner, organization.id);
      expect([stored.seatsUsed, stored.stringsUsed, usage.seats.used, usage.strings.used]).toEqual([seats, strings, seats, strings]);
    };

    beforeAll(async () => {
      owner = await signupTestUser(app, 'counters-owner@test.com');
      organization = await ownOrganizationOf(owner);
    });

    it('follow term and locale removals', async () => {
      const projectId = await newProject(owner, organization.id);
      await addLocale(owner, projectId, 'de').expect(201);
      const terms = [];
      for (const value of ['one', 'two', 'three']) {
        terms.push((await addTerm(owner, projectId, value).expect(201)).body.data.id);
      }
      await expectCountersMatch(1, 3);
      await call('delete', `/api/v1/projects/${projectId}/terms/${terms[0]}`).set(auth(owner)).expect(204);
      await expectCountersMatch(1, 2);
      await addLocale(owner, projectId, 'fr').expect(201);
      await expectCountersMatch(1, 4);
      await call('delete', `/api/v1/projects/${projectId}/translations/fr`).set(auth(owner)).expect(204);
      await expectCountersMatch(1, 2);
    });

    it('follow a project removal: its strings and its pending invitations go', async () => {
      const projectId = await newProject(owner, organization.id);
      await addLocale(owner, projectId, 'de').expect(201);
      await addTerm(owner, projectId, 'gone').expect(201);
      await projectInvite(owner, projectId, 'counters-pending@test.com').expect(201);
      await expectCountersMatch(2, 3);
      await call('delete', `/api/v1/projects/${projectId}`).set(auth(owner)).expect(204);
      await expectCountersMatch(1, 2);
    });

    it('follow a pending invitation that becomes a member', async () => {
      const projectId = await newProject(owner, organization.id);
      // An account whose e-mail is not verified yet gets an invitation; once verified, a new invite adds it at once
      const later = await signupTestUser(app, 'counters-later@test.com', false);
      await projectInvite(owner, projectId, later.email).expect(201);
      await expectCountersMatch(2, 2);
      await dataSource.getRepository(User).update({ id: later.id }, { emailVerified: true });
      const added = await projectInvite(owner, projectId, later.email).expect(201);
      expect(added.body.data.userId).toBe(later.id);
      expect(await dataSource.getRepository(Invite).count({ where: { email: later.email } })).toBe(0);
      await expectCountersMatch(2, 2);
    });
  });

  describe('usage', () => {
    it('answers the owner and the admins only', async () => {
      const owner = await signupTestUser(app, 'usage-owner@test.com');
      const admin = await signupTestUser(app, 'usage-admin@test.com');
      const member = await signupTestUser(app, 'usage-member@test.com');
      const outsider = await signupTestUser(app, 'usage-outsider@test.com');
      const organization = await ownOrganizationOf(owner);
      await call('post', `/api/v1/organizations/${organization.id}/invites`).set(auth(owner)).send({ email: admin.email, role: 'admin' }).expect(201);
      await invite(owner, organization.id, member.email).expect(201);

      expect((await usageOf(admin, organization.id)).seats.used).toBe(3);
      await call('get', `/api/v1/organizations/${organization.id}/usage`).set(auth(member)).expect(404);
      await call('get', `/api/v1/organizations/${organization.id}/usage`).set(auth(outsider)).expect(404);
      await call('get', `/api/v1/organizations/${organization.id}/usage`).expect(401);
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
      await call('get', `/api/v1/organizations/${defaultOrganization.id}/usage`).set(auth(user)).expect(404);
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
