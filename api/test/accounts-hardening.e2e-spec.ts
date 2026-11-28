import { INestApplication } from '@nestjs/common';
import * as nock from 'nock';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { controllersOf, routesOf } from '../src/access/routes';
import { currentLegalDocuments } from '../src/accounts/legal-documents';
import { AppModule } from '../src/app.module';
import { config } from '../src/config';
import { Invite, InviteStatus } from '../src/entity/invite.entity';
import { Organization } from '../src/entity/organization.entity';
import { User } from '../src/entity/user.entity';
import MailService from '../src/services/mail.service';
import { createAndMigrateApp, createTestProject, createTestProjectClient, currentTerms, signupTestUser, TestingUser } from './util';

/**
 * Accounts and hardening (DESIGN §3.8, P5): the e-mail and terms gate of the `AccessGuard`, terms versions recorded at
 * sign-up, Cloudflare Turnstile, the sign-up limit behind a trusted proxy, helmet's headers, the CORS allowlist, and a
 * member's e-mail change that can no longer push an organization over its seats. Single-tenant mode stays as it was.
 */

const isLocal = (host: string) => host.startsWith('127.0.0.1') || host.startsWith('localhost') || host.startsWith('[::1]');
const TURNSTILE = 'https://challenges.cloudflare.com';
const SITEVERIFY = '/turnstile/v0/siteverify';
const ANY_ID = '00000000-0000-4000-8000-000000000000';

/** Every route of the app that a signed-in person calls, with its parameters filled in. */
const PERSON_ROUTES = routesOf(controllersOf([AppModule]))
  .filter(route => route.access && !['public', 'webhook'].includes(route.access.rule) && !route.access.options.enabled)
  .map(route => ({ ...route, url: route.path.replace(/:[A-Za-z]+/g, ANY_ID) }));

/** Saves and restores the settings a test changes. */
function preserving(read: () => Record<string, unknown>, write: (saved: Record<string, unknown>) => void) {
  let saved: Record<string, unknown>;
  return {
    save: () => (saved = read()),
    restore: () => write(saved),
  };
}

const settings = preserving(
  () => ({
    saas: config.saasEnabled,
    requireVerifiedEmail: config.accounts.requireVerifiedEmail,
    terms: { ...config.accounts.terms },
    privacy: { ...config.accounts.privacy },
    turnstile: { ...config.turnstile },
    trustProxy: config.http.trustProxy,
    corsOrigins: config.http.corsOrigins,
    corsEnabled: config.corsEnabled,
    signupsPerHour: config.throttle.signupsPerHour,
    virtualHost: config.virtualHost,
  }),
  saved => {
    config.saasEnabled = saved.saas as boolean;
    config.accounts.requireVerifiedEmail = saved.requireVerifiedEmail as boolean | undefined;
    Object.assign(config.accounts.terms, saved.terms);
    Object.assign(config.accounts.privacy, saved.privacy);
    Object.assign(config.turnstile, saved.turnstile);
    config.http.trustProxy = saved.trustProxy as number | undefined;
    config.http.corsOrigins = saved.corsOrigins as string[];
    config.corsEnabled = saved.corsEnabled as boolean;
    config.throttle.signupsPerHour = saved.signupsPerHour as number;
    config.virtualHost = saved.virtualHost as string;
  },
);

describe('Accounts and hardening (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  const server = () => app.getHttpServer();
  const auth = (user: { accessToken: string }) => ({ Authorization: `Bearer ${user.accessToken}` });
  const call = (method: string, url: string) => request(server())[method.toLowerCase()](url);

  /** A sign-up as the web app sends it: SaaS mode needs the terms in force */
  const signup = (email: string, extra: Record<string, unknown> = {}) =>
    request(server())
      .post('/api/v1/auth/signup')
      .send({ name: `Tester ${email}`, email, password: 'mysupersecretpassword', ...currentTerms(), ...extra });

  let lastVerifyUrl: string | undefined;
  const captureVerificationLinks = () => {
    const mail = app.get(MailService);
    jest.spyOn(mail, 'welcomeNewUser').mockImplementation(async (_, url) => {
      lastVerifyUrl = url;
    });
    jest.spyOn(mail, 'verifyEmail').mockImplementation(async (_, url) => {
      lastVerifyUrl = url;
    });
  };

  const start = async (changes: () => void = () => undefined) => {
    changes();
    app = await createAndMigrateApp();
    dataSource = app.get(DataSource);
    captureVerificationLinks();
  };

  beforeEach(() => settings.save());

  afterEach(async () => {
    settings.restore();
    jest.restoreAllMocks();
    nock.cleanAll();
    nock.enableNetConnect();
    await app?.close();
    app = undefined;
  });

  describe('e-mail verification (SaaS mode)', () => {
    let person: TestingUser;

    beforeEach(async () => {
      await start(() => (config.saasEnabled = true));
      person = (await signup('unverified@test.com').expect(200)).body.data;
    });

    it('answers 403 email_not_verified on every route but the account ones, until the e-mail is confirmed', async () => {
      const gated = PERSON_ROUTES.filter(route => !route.access.options.whilePending);
      const open = PERSON_ROUTES.filter(route => route.access.options.whilePending);
      expect(gated.length).toBeGreaterThan(40);

      const wrong: string[] = [];
      for (const route of gated) {
        const res = await call(route.method, route.url).set(auth(person)).send({});
        if (res.status !== 403 || res.body.error?.code !== 'email_not_verified') {
          wrong.push(`${route.method} ${route.path}: ${res.status} ${res.body.error?.code}`);
        }
      }
      expect(wrong).toEqual([]);

      // The account's own routes work: users/me, verify, resend, the terms, the sign-in methods, the password
      for (const route of open.filter(each => !(each.method === 'DELETE' && each.path === '/api/v1/users/me'))) {
        const res = await call(route.method, route.url).set(auth(person)).send({});
        expect([route.path, res.body.error?.code]).not.toEqual([route.path, 'email_not_verified']);
      }
      expect(open.map(route => `${route.method} ${route.path}`).sort()).toEqual(
        [
          'DELETE /api/v1/auth/identities/:id',
          'DELETE /api/v1/users/me',
          'GET /api/v1/auth/identities',
          'GET /api/v1/users/me',
          'PATCH /api/v1/users/me',
          'POST /api/v1/auth/accept-terms',
          'POST /api/v1/auth/change-password',
          'POST /api/v1/auth/identities/connect',
          'POST /api/v1/auth/identities/connect/confirm',
          'POST /api/v1/auth/resend-verification-email',
          'POST /api/v1/auth/verify-email',
        ].sort(),
      );
      const me = await request(server()).get('/api/v1/users/me').set(auth(person)).expect(200);
      expect(me.body.data).toMatchObject({ email: 'unverified@test.com', emailVerified: false, pending: 'email_not_verified' });

      // The link of the welcome email opens everything
      lastVerifyUrl = undefined;
      await request(server()).post('/api/v1/auth/resend-verification-email').set(auth(person)).expect(204);
      const token = new URL(lastVerifyUrl).searchParams.get('token');
      await request(server()).post('/api/v1/auth/verify-email').set(auth(person)).send({ token }).expect(200);
      await request(server()).get('/api/v1/projects').set(auth(person)).expect(200);
      await request(server()).get('/api/v1/organizations').set(auth(person)).expect(200);
      expect((await request(server()).get('/api/v1/users/me').set(auth(person)).expect(200)).body.data.pending).toBeNull();
    });

    it('lets an unconfirmed person delete their account', async () => {
      await request(server()).delete('/api/v1/users/me').set(auth(person)).expect(204);
    });

    it('never asks an API key, which has no account to confirm', async () => {
      const owner = await signupTestUser(app, 'key-owner@test.com');
      const project = await createTestProject(app, owner);
      const client = await createTestProjectClient(app, owner, project);
      await request(server()).get(`/api/v1/projects/${project.id}/terms`).set(auth(client)).expect(200);
    });

    it('is off with TR_REQUIRE_VERIFIED_EMAIL=false', async () => {
      config.accounts.requireVerifiedEmail = false;
      await request(server()).get('/api/v1/organizations').set(auth(person)).expect(200);
      expect((await request(server()).get('/api/v1/users/me').set(auth(person)).expect(200)).body.data.pending).toBeNull();
    });
  });

  describe('single-tenant mode', () => {
    beforeEach(() => start(() => (config.saasEnabled = false)));

    it('asks for no confirmation, no terms and no Turnstile, as before', async () => {
      const providers = await request(server()).get('/api/v1/auth/providers').expect(200);
      expect(providers.body).toEqual({ saas: false, data: [] });
      const res = await request(server())
        .post('/api/v1/auth/signup')
        .send({ name: 'Plain', email: 'plain@test.com', password: 'mysupersecretpassword' })
        .expect(200);
      const person = res.body.data;
      await request(server()).get('/api/v1/projects').set(auth(person)).expect(200);
      await request(server()).post('/api/v1/projects').set(auth(person)).send({ name: 'Mine' }).expect(201);
      expect((await request(server()).get('/api/v1/users/me').set(auth(person)).expect(200)).body.data.pending).toBeNull();
      const stored = await dataSource.getRepository(User).findOneByOrFail({ id: person.id });
      expect([stored.termsVersion, stored.privacyVersion, stored.termsAcceptedAt]).toEqual([null, null, null]);
      const accept = await request(server()).post('/api/v1/auth/accept-terms').set(auth(person)).send(currentTerms()).expect(404);
      expect(accept.body.error.code).toBe('saas_disabled');
    });

    it('applies the e-mail gate when TR_REQUIRE_VERIFIED_EMAIL=true', async () => {
      config.accounts.requireVerifiedEmail = true;
      const person = await signupTestUser(app, 'gated-single@test.com', false);
      const res = await request(server()).get('/api/v1/projects').set(auth(person)).expect(403);
      expect(res.body.error.code).toBe('email_not_verified');
    });

    it('leaves the pending invitations of a changed e-mail alone', async () => {
      const admin = await signupTestUser(app, 'single-admin@test.com');
      const person = await signupTestUser(app, 'single-person@test.com', false);
      const project = await createTestProject(app, admin);
      await request(server())
        .post(`/api/v1/projects/${project.id}/invites`)
        .set(auth(admin))
        .send({ email: person.email, role: 'viewer' })
        .expect(201);
      await request(server()).patch('/api/v1/users/me').set(auth(person)).send({ email: 'single-person-new@test.com' }).expect(200);
      expect(await dataSource.getRepository(Invite).count({ where: { email: 'single-person@test.com', status: InviteStatus.Sent } })).toBe(1);
    });
  });

  describe('terms of service and privacy policy (SaaS mode)', () => {
    beforeEach(() => start(() => (config.saasEnabled = true)));

    it('lists the versions in force, from @ever-co/legal, with where to read them', async () => {
      const legal = currentLegalDocuments();
      expect(legal.terms.version).toMatch(/^\d+\.\d+\.\d+$/);
      const providers = await request(server()).get('/api/v1/auth/providers').expect(200);
      expect(providers.body.legal).toEqual({
        terms: { version: legal.terms.version, url: 'https://traduora.co/tos' },
        privacy: { version: legal.privacy.version, url: 'https://traduora.co/privacy' },
      });
    });

    it('records the versions accepted at sign-up, and refuses a sign-up without them or with older ones', async () => {
      for (const terms of [{}, { termsVersion: '0.0.1', privacyVersion: currentTerms().privacyVersion }]) {
        const res = await request(server())
          .post('/api/v1/auth/signup')
          .send({ name: 'No terms', email: 'no-terms@test.com', password: 'mysupersecretpassword', ...terms })
          .expect(400);
        expect(res.body.error.code).toBe('terms_not_accepted');
      }
      expect(await dataSource.getRepository(User).count({ where: { email: 'no-terms@test.com' } })).toBe(0);

      const before = Date.now();
      const created = (await signup('with-terms@test.com').expect(200)).body.data;
      const stored = await dataSource.getRepository(User).findOneByOrFail({ id: created.id });
      expect({ termsVersion: stored.termsVersion, privacyVersion: stored.privacyVersion }).toEqual(currentTerms());
      expect(new Date(stored.termsAcceptedAt).getTime()).toBeGreaterThanOrEqual(before - 1000);
    });

    it('asks again for a new version before anything else works, and records the acceptance', async () => {
      const person = await signupTestUser(app, 'terms-again@test.com');
      await request(server()).get('/api/v1/projects').set(auth(person)).expect(200);

      config.accounts.terms.version = '99.0.0';
      const gated = await request(server()).get('/api/v1/projects').set(auth(person)).expect(403);
      expect(gated.body.error.code).toBe('terms_not_accepted');
      expect((await request(server()).get('/api/v1/users/me').set(auth(person)).expect(200)).body.data.pending).toBe('terms_not_accepted');
      expect((await request(server()).get('/api/v1/auth/providers').expect(200)).body.legal.terms.version).toBe('99.0.0');

      // An acceptance of the older text is refused; the current one opens the app again
      const stale = await request(server())
        .post('/api/v1/auth/accept-terms')
        .set(auth(person))
        .send({ ...currentTerms(), termsVersion: '1.0.0' });
      expect([stale.status, stale.body.error.code]).toEqual([400, 'terms_not_accepted']);
      await request(server()).post('/api/v1/auth/accept-terms').set(auth(person)).send(currentTerms()).expect(204);
      await request(server()).get('/api/v1/projects').set(auth(person)).expect(200);
      const stored = await dataSource.getRepository(User).findOneByOrFail({ id: person.id });
      expect(stored.termsVersion).toBe('99.0.0');
    });

    it('confirms the e-mail before the terms: the first pending step answers', async () => {
      const person = (await signup('both-pending@test.com').expect(200)).body.data;
      config.accounts.privacy.version = '99.0.0';
      expect((await request(server()).get('/api/v1/projects').set(auth(person)).expect(403)).body.error.code).toBe('email_not_verified');
      await dataSource.getRepository(User).update({ id: person.id }, { emailVerified: true });
      expect((await request(server()).get('/api/v1/projects').set(auth(person)).expect(403)).body.error.code).toBe('terms_not_accepted');
    });
  });

  describe('Cloudflare Turnstile', () => {
    const turnstileOn = () => {
      config.saasEnabled = true;
      // Cloudflare's published dummy keys ("always passes"); the answers here come from nock, never from Cloudflare
      config.turnstile.siteKey = '1x00000000000000000000AA';
      config.turnstile.secretKey = '1x0000000000000000000000000000000AA';
    };
    const siteverify = (success: boolean, seen: string[] = []) =>
      nock(TURNSTILE)
        .post(SITEVERIFY, body => {
          seen.push(typeof body === 'string' ? body : new URLSearchParams(body).toString());
          return true;
        })
        .reply(200, success ? { success: true } : { success: false, 'error-codes': ['invalid-input-response'] });

    beforeEach(() => {
      nock.disableNetConnect();
      nock.enableNetConnect(isLocal);
    });

    it('is off without the keys: sign-up and forgot-password work without a token, and nothing is asked', async () => {
      await start(() => (config.saasEnabled = true));
      const scope = siteverify(true);
      expect((await request(server()).get('/api/v1/auth/providers').expect(200)).body.turnstileSiteKey).toBeUndefined();
      await signup('no-turnstile@test.com').expect(200);
      await request(server()).post('/api/v1/auth/forgot-password').send({ email: 'no-turnstile@test.com' }).expect(200);
      expect(scope.isDone()).toBe(false);
    });

    it('stays off with only one key', async () => {
      await start(() => {
        config.saasEnabled = true;
        config.turnstile.siteKey = '1x00000000000000000000AA';
      });
      await signup('one-key@test.com').expect(200);
    });

    it('hands the site key to the web app and checks every sign-up with siteverify', async () => {
      await start(turnstileOn);
      expect((await request(server()).get('/api/v1/auth/providers').expect(200)).body.turnstileSiteKey).toBe('1x00000000000000000000AA');

      // No token: refused before anything is asked or made
      const missing = await signup('bot@test.com').expect(400);
      expect(missing.body.error.code).toBe('turnstile_failed');

      siteverify(false);
      expect((await signup('bot@test.com', { turnstileToken: 'refused-token' }).expect(400)).body.error.code).toBe('turnstile_failed');
      expect(await dataSource.getRepository(User).count({ where: { email: 'bot@test.com' } })).toBe(0);

      const seen: string[] = [];
      siteverify(true, seen);
      await signup('human@test.com', { turnstileToken: 'good-token' }).expect(200);
      const form = new URLSearchParams(seen[0]);
      expect([form.get('secret'), form.get('response')]).toEqual(['1x0000000000000000000000000000000AA', 'good-token']);
      expect(form.get('remoteip')).toMatch(/127\.0\.0\.1/);
    });

    it('checks forgot-password, before the account is looked up', async () => {
      await start(turnstileOn);
      siteverify(true);
      await signup('forgetful@test.com', { turnstileToken: 'signup-token' }).expect(200);
      const reset = jest.spyOn(app.get(MailService), 'passwordResetToken').mockResolvedValue(undefined);

      expect((await request(server()).post('/api/v1/auth/forgot-password').send({ email: 'nobody@test.com' }).expect(400)).body.error.code).toBe(
        'turnstile_failed',
      );
      siteverify(true);
      await request(server()).post('/api/v1/auth/forgot-password').send({ email: 'forgetful@test.com', turnstileToken: 'good-token' }).expect(200);
      expect(reset).toHaveBeenCalledTimes(1);
    });

    it('answers 503 turnstile_unavailable when Cloudflare cannot be asked, and lets nothing through', async () => {
      await start(turnstileOn);
      nock(TURNSTILE).post(SITEVERIFY).replyWithError({ code: 'ECONNREFUSED', message: 'refused' });
      const res = await signup('unlucky@test.com', { turnstileToken: 'any-token' }).expect(503);
      expect(res.body.error.code).toBe('turnstile_unavailable');
      expect(await dataSource.getRepository(User).count({ where: { email: 'unlucky@test.com' } })).toBe(0);
    });
  });

  describe('rate limits behind a trusted proxy', () => {
    it('gives each forwarded address its own sign-up bucket (TR_SIGNUPS_PER_HOUR) and its own auth bucket', async () => {
      await start(() => {
        config.saasEnabled = true;
        config.http.trustProxy = 1;
        config.throttle.signupsPerHour = 2;
      });
      const from = (address: string, email: string) => signup(email).set('X-Forwarded-For', address);
      await from('203.0.113.1', 'proxy-a1@test.com').expect(200);
      await from('203.0.113.1', 'proxy-a2@test.com').expect(200);
      await from('203.0.113.1', 'proxy-a3@test.com').expect(429);
      // A failed attempt counts as well
      await from('203.0.113.2', 'proxy-a1@test.com').expect(409);
      await from('203.0.113.2', 'proxy-b1@test.com').expect(200);
      await from('203.0.113.2', 'proxy-b2@test.com').expect(429);

      // The auth limit of the global throttler (TR_AUTH_THROTTLE_LIMIT per minute) keys on the same address
      const forgot = (address: string) =>
        request(server()).post('/api/v1/auth/forgot-password').set('X-Forwarded-For', address).send({ email: 'nobody@test.com' });
      for (let i = 0; i < config.throttle.auth.limit; i++) {
        await forgot('198.51.100.1').expect(404);
      }
      await forgot('198.51.100.1').expect(429);
      await forgot('198.51.100.2').expect(404);
    });

    it('ignores X-Forwarded-For without TR_TRUST_PROXY: every request is the proxy', async () => {
      await start(() => {
        config.saasEnabled = true;
        config.throttle.signupsPerHour = 2;
      });
      await signup('direct-1@test.com').set('X-Forwarded-For', '203.0.113.1').expect(200);
      await signup('direct-2@test.com').set('X-Forwarded-For', '203.0.113.2').expect(200);
      await signup('direct-3@test.com').set('X-Forwarded-For', '203.0.113.3').expect(429);
    });

    it('limits no sign-up on a single-tenant install', async () => {
      await start(() => {
        config.saasEnabled = false;
        config.throttle.signupsPerHour = 1;
      });
      await signupTestUser(app, 'single-1@test.com');
      await signupTestUser(app, 'single-2@test.com');
    });
  });

  describe('headers', () => {
    it('sends a CSP for the app itself and Google Fonts, no HSTS on http, and the usual helmet headers', async () => {
      await start();
      for (const path of ['/api/v1/auth/providers', '/health']) {
        const res = await request(server()).get(path).expect(200);
        const csp = res.headers['content-security-policy'];
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("script-src 'self'");
        expect(csp).toContain("style-src 'self' 'unsafe-inline' https://fonts.googleapis.com");
        expect(csp).toContain("font-src 'self' https://fonts.gstatic.com data:");
        expect(csp).toContain("object-src 'none'");
        expect(csp).not.toContain('challenges.cloudflare.com');
        expect(csp).not.toContain('upgrade-insecure-requests');
        expect(res.headers['strict-transport-security']).toBeUndefined();
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
        expect(res.headers['x-powered-by']).toBeUndefined();
      }
    });

    it('adds HSTS for an https host, and Turnstile to the CSP when it is on', async () => {
      await start(() => {
        config.virtualHost = 'https://app.example.com';
        config.turnstile.siteKey = '1x00000000000000000000AA';
        config.turnstile.secretKey = '1x0000000000000000000000000000000AA';
      });
      const res = await request(server()).get('/health').expect(200);
      expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
      expect(res.headers['content-security-policy']).toContain(`script-src 'self' ${TURNSTILE}`);
      expect(res.headers['content-security-policy']).toContain(`frame-src 'self' ${TURNSTILE}`);
      expect(res.headers['content-security-policy']).toContain('upgrade-insecure-requests');
    });
  });

  describe('CORS', () => {
    const fromOrigin = (origin: string) => request(server()).get('/api/v1/auth/providers').set('Origin', origin);

    it('answers only the origins of TR_CORS_ORIGINS', async () => {
      await start(() => (config.http.corsOrigins = ['https://allowed.example', 'https://other.example']));
      const allowed = await fromOrigin('https://allowed.example').expect(200);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://allowed.example');
      expect(allowed.headers.vary).toMatch(/Origin/);
      const refused = await fromOrigin('https://evil.example').expect(200);
      expect(refused.headers['access-control-allow-origin']).toBeUndefined();
      const preflight = await request(server())
        .options('/api/v1/auth/token')
        .set('Origin', 'https://other.example')
        .set('Access-Control-Request-Method', 'POST')
        .expect(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('https://other.example');
    });

    it('keeps * for TR_CORS_ENABLED=true without a list, and sends nothing when both are unset', async () => {
      await start(() => (config.corsEnabled = true));
      expect((await fromOrigin('https://anyone.example').expect(200)).headers['access-control-allow-origin']).toBe('*');
      await app.close();
      config.corsEnabled = false;
      await start();
      expect((await fromOrigin('https://anyone.example').expect(200)).headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe("a member's e-mail change and the seats (P3 follow-up)", () => {
    beforeEach(() => start(() => (config.saasEnabled = true)));

    const tokenOf = (res: request.Response): string => new URL(res.body.data.inviteUrl).searchParams.get('invite');
    const usage = async (owner: TestingUser, organizationId: string) =>
      (await request(server()).get(`/api/v1/organizations/${organizationId}/usage`).set(auth(owner)).expect(200)).body.data.seats;

    const organizationOf = async (owner: TestingUser) =>
      (await request(server()).get('/api/v1/organizations').set(auth(owner)).expect(200)).body.data[0];
    const pendingEmails = async (owner: TestingUser, organizationId: string): Promise<string[]> =>
      (await request(server()).get(`/api/v1/organizations/${organizationId}/invites`).set(auth(owner)).expect(200)).body.data.map(each => each.email);
    /** Marks the account's address confirmed, as its link would, without the acceptances the link also makes */
    const confirmEmail = (user: { id: string }) => dataSource.getRepository(User).update({ id: user.id }, { emailVerified: true });

    it('drops the pending invitations to the confirmed former address, so the organization stays within its seats', async () => {
      const owner = await signupTestUser(app, 'full-owner@test.com');
      const [organization] = (await request(server()).get('/api/v1/organizations').set(auth(owner)).expect(200)).body.data;

      // A member who joined with an invitation link and has not confirmed their e-mail yet
      const invited = await request(server())
        .post(`/api/v1/organizations/${organization.id}/invites`)
        .set(auth(owner))
        .send({ email: 'mover@test.com', role: 'member' })
        .expect(201);
      const mover = (await signup('mover@test.com', { inviteToken: tokenOf(invited) }).expect(200)).body.data;
      // ...so a project invitation to their address stays pending; once they confirm it, it takes no seat of its own
      const projectId = (
        await request(server()).post('/api/v1/projects').set(auth(owner)).send({ name: 'P', organizationId: organization.id }).expect(201)
      ).body.data.id;
      await request(server())
        .post(`/api/v1/projects/${projectId}/invites`)
        .set(auth(owner))
        .send({ email: 'mover@test.com', role: 'editor' })
        .expect(201);
      // Another organization's invitation to the same address, where they are no member: it already takes a seat there
      const stranger = await signupTestUser(app, 'stranger-owner@test.com');
      const [elsewhere] = (await request(server()).get('/api/v1/organizations').set(auth(stranger)).expect(200)).body.data;
      await request(server())
        .post(`/api/v1/organizations/${elsewhere.id}/invites`)
        .set(auth(stranger))
        .send({ email: 'mover@test.com', role: 'member' })
        .expect(201);

      // Invited while unconfirmed, the member confirms the address: the invitation to it is theirs, no seat of its own
      expect(await usage(owner, organization.id)).toEqual({ used: 3, included: 15 });
      await confirmEmail(mover);
      expect(await usage(owner, organization.id)).toEqual({ used: 2, included: 15 });
      // Full: the owner, the member, and 13 pending invitations
      for (let i = 1; i <= 13; i++) {
        await request(server())
          .post(`/api/v1/organizations/${organization.id}/invites`)
          .set(auth(owner))
          .send({ email: `filler-${i}@test.com`, role: 'member' })
          .expect(201);
      }
      expect(await usage(owner, organization.id)).toEqual({ used: 15, included: 15 });
      expect(await usage(stranger, elsewhere.id)).toEqual({ used: 2, included: 15 });

      await request(server()).patch('/api/v1/users/me').set(auth(mover)).send({ email: 'moved@test.com' }).expect(200);

      expect(await usage(owner, organization.id)).toEqual({ used: 15, included: 15 });
      expect((await dataSource.getRepository(Organization).findOneByOrFail({ id: organization.id })).seatsUsed).toBe(15);
      expect(await dataSource.getRepository(Invite).count({ where: { email: 'mover@test.com', status: InviteStatus.Sent } })).toBe(0);
      // The other organization keeps its invitation, and its count
      expect(await usage(stranger, elsewhere.id)).toEqual({ used: 2, included: 15 });
      const theirs = (await request(server()).get(`/api/v1/organizations/${elsewhere.id}/invites`).set(auth(stranger)).expect(200)).body.data;
      expect(theirs.map(invite => invite.email)).toEqual(['mover@test.com']);
    });

    it("keeps someone else's invitations when a member types their address and then her own again (review of #679)", async () => {
      const owner = await signupTestUser(app, 'owner-of-victim@test.com');
      const organization = await organizationOf(owner);
      const mallory = await signupTestUser(app, 'mallory@test.com');
      await request(server())
        .post(`/api/v1/organizations/${organization.id}/invites`)
        .set(auth(owner))
        .send({ email: mallory.email, role: 'member' })
        .expect(201);
      // A pending invitation of someone with no account yet, and one to a project
      await request(server())
        .post(`/api/v1/organizations/${organization.id}/invites`)
        .set(auth(owner))
        .send({ email: 'victim@test.com', role: 'member' })
        .expect(201);
      const projectId = (
        await request(server()).post('/api/v1/projects').set(auth(owner)).send({ name: 'V', organizationId: organization.id }).expect(201)
      ).body.data.id;
      await request(server())
        .post(`/api/v1/projects/${projectId}/invites`)
        .set(auth(owner))
        .send({ email: 'project-victim@test.com', role: 'editor' })
        .expect(201);
      expect(await usage(owner, organization.id)).toEqual({ used: 4, included: 15 });

      // Holding the victim's address frees no seat: it is not confirmed
      await request(server()).patch('/api/v1/users/me').set(auth(mallory)).send({ email: 'victim@test.com' }).expect(200);
      expect(await usage(owner, organization.id)).toEqual({ used: 4, included: 15 });
      // Nor may a new invitation to it pass as a member's: the organization counts it
      await request(server()).patch('/api/v1/users/me').set(auth(mallory)).send({ email: 'project-victim@test.com' }).expect(200);
      expect(await usage(owner, organization.id)).toEqual({ used: 4, included: 15 });
      // Back to her own: the former address was never confirmed, so its invitations stay, as do the others
      await request(server()).patch('/api/v1/users/me').set(auth(mallory)).send({ email: 'mallory@test.com' }).expect(200);
      expect(await pendingEmails(owner, organization.id)).toEqual(['victim@test.com']);
      expect(await dataSource.getRepository(Invite).count({ where: { email: 'project-victim@test.com', status: InviteStatus.Sent } })).toBe(1);
      expect(await usage(owner, organization.id)).toEqual({ used: 4, included: 15 });
    });

    it("counts an invitation to a member's unconfirmed address as a seat", async () => {
      const owner = await signupTestUser(app, 'unconfirmed-owner@test.com');
      const organization = await organizationOf(owner);
      const invited = await request(server())
        .post(`/api/v1/organizations/${organization.id}/invites`)
        .set(auth(owner))
        .send({ email: 'unconfirmed@test.com', role: 'member' })
        .expect(201);
      const member = (await signup('unconfirmed@test.com', { inviteToken: tokenOf(invited) }).expect(200)).body.data;
      // Fill the organization: the owner, the member, 13 invitations
      for (let i = 1; i <= 13; i++) {
        await request(server())
          .post(`/api/v1/organizations/${organization.id}/invites`)
          .set(auth(owner))
          .send({ email: `seat-${i}@test.com`, role: 'member' })
          .expect(201);
      }
      expect(await usage(owner, organization.id)).toEqual({ used: 15, included: 15 });
      const projectId = (
        await request(server()).post('/api/v1/projects').set(auth(owner)).send({ name: 'U', organizationId: organization.id }).expect(201)
      ).body.data.id;
      // The member has not confirmed this address: an invitation to it needs a seat, and there is none
      const refused = await request(server())
        .post(`/api/v1/projects/${projectId}/invites`)
        .set(auth(owner))
        .send({ email: member.email, role: 'editor' });
      expect([refused.status, refused.body.error.code]).toEqual([402, 'plan_limit_reached']);
      // Once confirmed, the invitation is the member's own and is made (here as a direct add)
      await confirmEmail(member);
      await request(server())
        .post(`/api/v1/projects/${projectId}/invites`)
        .set(auth(owner))
        .send({ email: member.email, role: 'editor' })
        .expect(201);
      expect(await usage(owner, organization.id)).toEqual({ used: 15, included: 15 });
    });
  });
});
