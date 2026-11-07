import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as nock from 'nock';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { config } from '../src/config';
import { EverIdSession } from '../src/entity/ever-id-session.entity';
import { Invite, InviteStatus } from '../src/entity/invite.entity';
import { ProjectRole } from '../src/entity/project-user.entity';
import { UserIdentity } from '../src/entity/user-identity.entity';
import { issuerScopedKey } from '../src/services/ever-id-session.service';
import { User } from '../src/entity/user.entity';
import MailService from '../src/services/mail.service';
import { MockOidcIssuer, newAuthorizationRequest } from './mock-oidc/mock-oidc-issuer';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingUser } from './util';

const CLIENT_ID = 'traduora-e2e-client';
const CLIENT_SECRET = 'traduora-e2e-client-secret';
const REDIRECT_URL = 'http://localhost:8080/auth/callback';

const isLocal = (host: string) => host.startsWith('127.0.0.1') || host.startsWith('localhost');

describe('Ever ID sign-in (e2e)', () => {
  const everid = config.providers.everid;
  const google = config.providers.google;
  const originalEverId = { ...everid };
  const originalGoogle = { ...google };
  const originalSignupsEnabled = config.signupsEnabled;

  let issuer: MockOidcIssuer;
  let app: INestApplication;

  const server = () => app.getHttpServer();
  const repo = <T>(entity: new () => T) => app.get(Connection).getRepository(entity);

  const enableEverId = (overrides: Partial<typeof everid> = {}) =>
    Object.assign(everid, {
      active: true,
      issuer: issuer.issuer,
      allowedIssuers: [],
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUrl: REDIRECT_URL,
      installSource: undefined,
      backchannelLogoutEnabled: true,
      ...overrides,
    });

  /** What the webapp's callback posts after the person signed in at the issuer. */
  const everIdCallback = async (claims: Record<string, unknown> = {}) => {
    const authorization = newAuthorizationRequest();
    const code = await issuer.authorize(
      { redirectUri: REDIRECT_URL, nonce: authorization.nonce, codeChallenge: authorization.codeChallenge, state: authorization.state },
      claims,
    );
    return { code, provider: 'everid', state: authorization.state, nonce: authorization.nonce, code_verifier: authorization.codeVerifier };
  };

  const signInWithEverId = async (claims: Record<string, unknown> = {}) =>
    request(server())
      .post('/api/v1/auth/signup-provider')
      .send(await everIdCallback(claims));

  const confirmSignup = (pending: string, acceptInvites?: string[]) =>
    request(server()).post('/api/v1/auth/everid/signup-confirm').send({ pending, acceptInvites });

  /** Signs up a new person with Ever ID through the confirmation screen. */
  const signUpWithEverId = async (claims: Record<string, unknown>) => {
    const res = expectAnswer(await signInWithEverId(claims), 409);
    return (await confirmSignup(res.body.error.details.pending).expect(200)).body.data as TestingUser;
  };

  const me = (accessToken: string) => request(server()).get('/api/v1/users/me').set('Authorization', `Bearer ${accessToken}`);

  const connect = async (user: { accessToken: string }, claims: Record<string, unknown>) =>
    request(server())
      .post('/api/v1/auth/identities/connect')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send(await everIdCallback(claims));

  const confirmConnect = (user: { accessToken: string }, pending: string) =>
    request(server()).post('/api/v1/auth/identities/connect/confirm').set('Authorization', `Bearer ${user.accessToken}`).send({ pending });

  const backchannelLogout = (logoutToken: string) =>
    request(server()).post('/api/v1/auth/everid/backchannel-logout').type('form').send({ logout_token: logoutToken });

  /** Asserts the status (and error code) of an answer, and returns it. */
  const expectAnswer = (res: request.Response, status: number, code?: string) => {
    expect({ status: res.status, code: code === undefined ? undefined : res.body?.error?.code }).toEqual({ status, code });
    return res;
  };

  const decode = (token: string) => new JwtService({}).decode(token) as Record<string, unknown>;

  const closeApp = async () => {
    await app.get(Connection).close();
    await app.close();
    app = undefined;
  };

  beforeAll(async () => {
    issuer = new MockOidcIssuer(CLIENT_ID, CLIENT_SECRET);
    await issuer.start();
  });

  afterAll(async () => {
    await issuer.stop();
  });

  beforeEach(() => {
    issuer.requests.length = 0;
    issuer.failDiscovery = false;
  });

  afterEach(async () => {
    if (app) {
      await closeApp();
    }
    Object.assign(everid, originalEverId);
    Object.assign(google, originalGoogle);
    config.signupsEnabled = originalSignupsEnabled;
    nock.cleanAll();
    nock.enableNetConnect();
    nock.emitter.removeAllListeners('no match');
    jest.restoreAllMocks();
  });

  describe('when off', () => {
    it('lists no Ever ID provider, answers 400 on every Ever ID path and requests nothing from the issuer', async () => {
      Object.assign(everid, { active: false, issuer: issuer.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, redirectUrl: REDIRECT_URL });
      nock.disableNetConnect();
      nock.enableNetConnect(isLocal);
      app = await createAndMigrateApp();
      const user = await signupTestUser(app);

      await request(server())
        .get('/api/v1/auth/providers')
        .expect(200)
        .expect(res => expect(res.body.data).toEqual([]));
      await request(server())
        .post('/api/v1/auth/signup-provider')
        .send({ code: 'code', provider: 'everid', nonce: 'n', code_verifier: 'v'.repeat(43) })
        .expect(400);
      await request(server())
        .post('/api/v1/auth/token')
        .send({ grant_type: 'provider', code: 'code', provider: 'everid', nonce: 'n', code_verifier: 'v'.repeat(43) })
        .expect(400);
      await request(server()).post('/api/v1/auth/everid/signup-confirm').send({ pending: 'v1.x' }).expect(400);
      await request(server())
        .post('/api/v1/auth/identities/connect')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ code: 'code', nonce: 'n', code_verifier: 'v'.repeat(43) })
        .expect(400);
      await request(server()).get('/api/v1/auth/identities').set('Authorization', `Bearer ${user.accessToken}`).expect(400);
      await backchannelLogout('a.b.c').expect(400);

      expect(issuer.requests).toHaveLength(0);
    });

    it('keeps an Ever issuer off, without any request to it, unless the install is the Ever-operated cloud', async () => {
      enableEverId({ issuer: 'https://auth.ever.co' });
      const attempts: string[] = [];
      nock.disableNetConnect();
      nock.enableNetConnect(isLocal);
      // Any request nock lets through or blocks, except those of the test client to the app on 127.0.0.1
      nock.emitter.on('no match', (req: any) => {
        const host = String(req?.hostname ?? req?.host ?? req);
        if (!isLocal(host)) {
          attempts.push(host);
        }
      });
      const discovery = nock('https://auth.ever.co').get('/.well-known/openid-configuration').reply(500);
      app = await createAndMigrateApp();

      await request(server())
        .get('/api/v1/auth/providers')
        .expect(200)
        .expect(res => expect(res.body.data).toEqual([]));
      await request(server())
        .post('/api/v1/auth/signup-provider')
        .send({ code: 'code', provider: 'everid', nonce: 'n', code_verifier: 'v'.repeat(43) })
        .expect(400);
      expect(discovery.isDone()).toBe(false);
      expect(attempts).toEqual([]);
    });

    it('stays off when the discovery fails, and the app still starts', async () => {
      issuer.failDiscovery = true;
      enableEverId();
      app = await createAndMigrateApp();
      await request(server())
        .get('/api/v1/auth/providers')
        .expect(200)
        .expect(res => expect(res.body.data).toEqual([]));
      expectAnswer(await signInWithEverId(), 400, 'provider_disabled');
    });
  });

  describe('when on', () => {
    beforeEach(async () => {
      enableEverId();
      app = await createAndMigrateApp();
    });

    it('lists Ever ID with its scope and PKCE but never its client secret, and the Google entry as before', async () => {
      await closeApp();
      Object.assign(google, { active: true, clientId: 'google-client', clientSecret: 'google-secret', redirectUrl: REDIRECT_URL });
      app = await createAndMigrateApp();

      const res = await request(server()).get('/api/v1/auth/providers').expect(200);
      const [googleEntry, everIdEntry] = res.body.data;
      expect(googleEntry).toHaveExactProperties(['slug', 'url', 'redirectUrl', 'clientId']);
      expect(googleEntry.slug).toBe('google');
      expect(everIdEntry).toHaveExactProperties(['slug', 'url', 'redirectUrl', 'clientId', 'scope', 'pkce']);
      expect(everIdEntry).toEqual({
        slug: 'everid',
        url: `${issuer.issuer}/oauth/v2/authorize`,
        redirectUrl: REDIRECT_URL,
        clientId: CLIENT_ID,
        scope: 'openid profile email',
        pkce: true,
      });
      expect(JSON.stringify(res.body)).not.toContain(CLIENT_SECRET);
      expect(JSON.stringify(res.body)).not.toContain('google-secret');
    });

    it('asks a new person to confirm, creates nothing before, then creates the account with a revocable token', async () => {
      const welcome = jest.spyOn(app.get(MailService), 'welcomeNewUser').mockResolvedValue(undefined);
      const usersBefore = await repo(User).count();

      const res = await signInWithEverId({ sub: 'new-person', email: 'new.person@example.test', name: 'New Person' });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('signup_confirmation_required');
      expect(res.body.error.details).toHaveExactProperties(['pending', 'name', 'email', 'invites']);
      expect(res.body.error.details).toMatchObject({ name: 'New Person', email: 'new.person@example.test', invites: [] });
      expect(res.body.error.details.pending).not.toContain('new.person');
      expect(await repo(User).count()).toBe(usersBefore);
      expect(await repo(UserIdentity).count()).toBe(0);

      const created = await confirmSignup(res.body.error.details.pending).expect(200);
      expect(created.body.data).toHaveExactProperties(['id', 'email', 'name', 'accessToken']);
      expect(created.body.data).toMatchObject({ email: 'new.person@example.test', name: 'New Person' });

      const identities = await repo(UserIdentity).find({ relations: ['user'] });
      expect(identities).toHaveLength(1);
      expect(identities[0]).toMatchObject({ provider: 'everid', issuer: issuer.issuer, subject: 'new-person', linkMethod: 'jit' });
      expect(identities[0].user.id).toBe(created.body.data.id);
      expect(welcome).toHaveBeenCalledTimes(1);

      const claims = decode(created.body.data.accessToken);
      // The session of the issuer, by an issuer-scoped key
      expect(claims).toMatchObject({ sub: created.body.data.id, type: 'user', sid: issuerScopedKey(issuer.issuer, 'sid-new-person') });
      expect(typeof claims.jti).toBe('string');
      const profile = await me(created.body.data.accessToken).expect(200);
      expect(profile.body.data.emailVerified).toBe(true);

      // The record creates one account only
      await confirmSignup(res.body.error.details.pending).expect(409);
    });

    it('never signs in to nor links an existing account that only has the same email', async () => {
      const existing = await signupTestUser(app, 'taken@example.test');

      const res = await signInWithEverId({ sub: 'someone-else', email: 'taken@example.test' });
      expect(res.status).toBe(409);
      expect(res.body.error).toHaveExactProperties(['code', 'message']);
      expect(res.body.error.code).toBe('account_exists');
      expect(JSON.stringify(res.body)).not.toContain(existing.id);
      expect(await repo(UserIdentity).count()).toBe(0);

      await request(server())
        .post('/api/v1/auth/token')
        .send({ grant_type: 'provider', ...(await everIdCallback({ sub: 'someone-else', email: 'taken@example.test' })) })
        .expect(409)
        .expect(r => expect(r.body.error.code).toBe('account_exists'));
    });

    it('with signups disabled, refuses an uninvited person and accepts only the invitations ticked on the confirmation screen', async () => {
      const admin = await signupTestUser(app, 'admin@example.test');
      const project = await createTestProject(app, admin);
      config.signupsEnabled = false;

      expectAnswer(await signInWithEverId({ sub: 'uninvited', email: 'uninvited@example.test' }), 403, 'signup_disabled');

      const invite = async (email: string) =>
        (
          await request(server())
            .post(`/api/v1/projects/${project.id}/invites`)
            .set('Authorization', `Bearer ${admin.accessToken}`)
            .send({ email, role: 'editor' })
            .expect(201)
        ).body.data.id as string;
      const projectRole = async (user: TestingUser) => {
        const res = await request(server()).get(`/api/v1/projects/${project.id}`).set('Authorization', `Bearer ${user.accessToken}`);
        return res.status === 200 ? res.body.data.role : undefined;
      };

      const firstInvite = await invite('first@example.test');
      const first = await signInWithEverId({ sub: 'first', email: 'first@example.test' });
      expect(first.status).toBe(409);
      expect(first.body.error.details.invites).toEqual([{ id: firstInvite, projectName: project.name }]);
      expect(await repo(User).count({ where: { email: 'first@example.test' } })).toBe(0);
      const firstUser = (await confirmSignup(first.body.error.details.pending, []).expect(200)).body.data;
      expect(await projectRole(firstUser)).toBeUndefined();
      expect((await repo(Invite).findOneBy({ id: firstInvite })).status).toBe(InviteStatus.Sent);

      const secondInvite = await invite('second@example.test');
      const second = await signInWithEverId({ sub: 'second', email: 'second@example.test' });
      const secondUser = (await confirmSignup(second.body.error.details.pending, [secondInvite]).expect(200)).body.data;
      expect(await projectRole(secondUser)).toBe('editor');
      expect((await repo(Invite).findOneBy({ id: secondInvite })).status).toBe(InviteStatus.Accepted);
    });

    it('signs in a connected identity even after its email changed, without accepting pending invitations', async () => {
      const user = await signUpWithEverId({ sub: 'returning', email: 'returning@example.test' });
      const admin = await signupTestUser(app, 'admin@example.test');
      const project = await createTestProject(app, admin);
      // An invitation for the account's email, still pending
      const pendingInvite = await repo(Invite).save(
        repo(Invite).create({ email: 'returning@example.test', status: InviteStatus.Sent, role: ProjectRole.Viewer, project: { id: project.id } }),
      );

      const res = expectAnswer(await signInWithEverId({ sub: 'returning', email: 'changed@example.test' }), 201);
      expect(res.body.data).toHaveExactProperties(['id', 'email', 'name', 'accessToken']);
      expect(res.body.data.id).toBe(user.id);
      expect(res.body.data.email).toBe('returning@example.test');
      expect((await repo(Invite).findOneBy({ id: pendingInvite.id })).status).toBe(InviteStatus.Sent);
      const identity = await repo(UserIdentity).findOneBy({ subject: 'returning' });
      expect(identity.lastLoginAt).toBeInstanceOf(Date);

      // The token grant signs in the same account
      await request(server())
        .post('/api/v1/auth/token')
        .send({ grant_type: 'provider', ...(await everIdCallback({ sub: 'returning' })) })
        .expect(200)
        .expect(r => expect(r.body.data).toHaveExactProperties(['accessToken']));
    });

    it('rejects a code without the matching PKCE verifier or nonce', async () => {
      const callback = await everIdCallback({ sub: 'person' });
      await request(server())
        .post('/api/v1/auth/signup-provider')
        .send({ ...callback, code_verifier: 'w'.repeat(43) })
        .expect(400)
        .expect(res => expect(res.body.error.code).toBe('sign_in_failed'));

      const another = await everIdCallback({ sub: 'person' });
      await request(server())
        .post('/api/v1/auth/signup-provider')
        .send({ ...another, nonce: 'another-nonce' })
        .expect(400)
        .expect(res => expect(res.body.error.code).toBe('sign_in_failed'));

      expectAnswer(await signInWithEverId({ sub: 'unverified', email_verified: false }), 400, 'email_unverified');
    });

    it('connects Ever ID from the settings after a recent sign-in, with both emails, and then signs in with it', async () => {
      const user = await signupTestUser(app, 'member@example.test');
      const other = await signupTestUser(app, 'other@example.test');
      const now = Math.floor(Date.now() / 1000);

      expectAnswer(await connect(user, { sub: 'member-id', email: 'member.id@example.test', auth_time: now - 400 }), 400, 'reauth_required');
      expect(await repo(UserIdentity).count()).toBe(0);

      const started = expectAnswer(await connect(user, { sub: 'member-id', email: 'member.id@example.test', auth_time: now - 200 }), 200);
      expect(started.body.data).toHaveExactProperties(['pending', 'emails']);
      expect(started.body.data.emails).toEqual({ account: 'member@example.test', everId: 'member.id@example.test' });
      expect(await repo(UserIdentity).count()).toBe(0);

      await confirmConnect(other, started.body.data.pending).expect(403);
      const connected = await confirmConnect(user, started.body.data.pending).expect(200);
      expect(connected.body.data).toMatchObject({ provider: 'everid', email: 'member.id@example.test', linkMethod: 'explicit' });

      const signedIn = expectAnswer(await signInWithEverId({ sub: 'member-id', email: 'member.id@example.test' }), 201);
      expect(signedIn.body.data.id).toBe(user.id);

      // The same Ever ID cannot be connected to another account
      expectAnswer(await connect(other, { sub: 'member-id', auth_time: now }), 409, 'subject_linked');
      await confirmConnect(other, started.body.data.pending).expect(403);
    });

    it('lists and disconnects identities, but never the last way to sign in', async () => {
      const everIdOnly = await signUpWithEverId({ sub: 'only-ever-id', email: 'only@example.test' });
      const list = await request(server()).get('/api/v1/auth/identities').set('Authorization', `Bearer ${everIdOnly.accessToken}`).expect(200);
      expect(list.body.data).toHaveLength(1);
      expect(list.body.data[0]).toHaveExactProperties(['id', 'provider', 'email', 'linkMethod', 'linkedAt', 'lastLoginAt']);
      await request(server())
        .delete(`/api/v1/auth/identities/${list.body.data[0].id}`)
        .set('Authorization', `Bearer ${everIdOnly.accessToken}`)
        .expect(409)
        .expect(r => expect(r.body.error.code).toBe('last_sign_in_method'));

      const withPassword = await signupTestUser(app, 'with-password@example.test');
      const started = expectAnswer(await connect(withPassword, { sub: 'pw-id' }), 200);
      const identity = (await confirmConnect(withPassword, started.body.data.pending).expect(200)).body.data;

      // Not someone else's
      await request(server()).delete(`/api/v1/auth/identities/${identity.id}`).set('Authorization', `Bearer ${everIdOnly.accessToken}`).expect(404);
      await request(server()).delete(`/api/v1/auth/identities/${identity.id}`).set('Authorization', `Bearer ${withPassword.accessToken}`).expect(204);
      await request(server())
        .get('/api/v1/auth/identities')
        .set('Authorization', `Bearer ${withPassword.accessToken}`)
        .expect(200)
        .expect(r => expect(r.body.data).toEqual([]));
    });

    it('back-channel logout ends the sessions of that Ever ID session only, and only once', async () => {
      const alice = await signUpWithEverId({ sub: 'alice', email: 'alice@example.test', sid: 'sid-alice' });
      const bob = await signUpWithEverId({ sub: 'bob', email: 'bob@example.test', sid: 'sid-bob' });
      const passwordUser = await signupTestUser(app, 'password@example.test');
      expect(decode(passwordUser.accessToken).sid).toBeUndefined();
      await me(alice.accessToken).expect(200);

      const logoutToken = await issuer.logoutToken({ sid: 'sid-alice', sub: 'alice' });
      await backchannelLogout(logoutToken)
        .expect(200)
        .expect(res => expect(res.headers['cache-control']).toBe('no-store'));
      expect((await repo(EverIdSession).findOneBy({ sid: issuerScopedKey(issuer.issuer, 'sid-alice') })).revokedAt).toBeInstanceOf(Date);

      await me(alice.accessToken).expect(401);
      await me(bob.accessToken).expect(200);
      await me(passwordUser.accessToken).expect(200);

      // A copy of the token, a token older than 300 s, and a token without the logout event are refused
      await backchannelLogout(logoutToken).expect(400);
      await backchannelLogout(await issuer.logoutToken({ sid: 'sid-bob' }, 301)).expect(400);
      await backchannelLogout(await issuer.logoutToken({ sid: 'sid-bob' }, 0, { events: {} })).expect(400);
      await backchannelLogout('not-a-token').expect(400);
      await me(bob.accessToken).expect(200);

      // A logout naming only the subject ends that person's sessions
      await backchannelLogout(await issuer.logoutToken({ sub: 'bob' })).expect(200);
      await me(bob.accessToken).expect(401);
      await me(passwordUser.accessToken).expect(200);
    });

    it('back-channel logout can be turned off on its own', async () => {
      await closeApp();
      enableEverId({ backchannelLogoutEnabled: false });
      app = await createAndMigrateApp();
      await backchannelLogout(await issuer.logoutToken({ sid: 'sid-x' })).expect(400);
    });
  });

  describe('migration', () => {
    it('reverts and applies again, creating and dropping only its own tables', async () => {
      app = await createAndMigrateApp();
      const connection = app.get(Connection);
      const tables = ['user_identity', 'ever_id_session', 'ever_id_logout_jti'];
      const hasTables = async (names: string[]) => {
        const runner = connection.createQueryRunner();
        try {
          return await Promise.all(names.map(name => runner.hasTable(name)));
        } finally {
          await runner.release();
        }
      };
      const user = await signupTestUser(app, 'kept@example.test');
      expect(await hasTables(tables)).toEqual([true, true, true]);

      await connection.undoLastMigration();
      expect(await hasTables(tables)).toEqual([false, false, false]);
      expect(await hasTables(['user', 'project', 'invite'])).toEqual([true, true, true]);
      expect(await repo(User).count({ where: { id: user.id } })).toBe(1);

      await connection.runMigrations();
      expect(await hasTables(tables)).toEqual([true, true, true]);
      // Applying it twice is harmless (tables are created only if missing)
      const queryRunner = connection.createQueryRunner();
      try {
        await connection.migrations.find(migration => migration.constructor.name === 'everId1794009600000').up(queryRunner);
      } finally {
        await queryRunner.release();
      }
      expect(await repo(UserIdentity).count()).toBe(0);
    });
  });

  describe('Google sign-in', () => {
    it('sends the same token request as before and still finds the account by email', async () => {
      Object.assign(google, {
        active: true,
        clientId: 'google-client-id',
        clientSecret: 'google-client-secret',
        redirectUrl: 'http://localhost:8080/auth/callback',
      });
      enableEverId();
      nock.disableNetConnect();
      nock.enableNetConnect(isLocal);
      app = await createAndMigrateApp();
      const existing = await signupTestUser(app, 'google.user@example.test');

      const expectedBody =
        'access_type=offline&code=google-code&client_id=google-client-id&client_secret=google-client-secret' +
        '&redirect_uri=http://localhost:8080/auth/callback&grant_type=authorization_code';
      const idToken = new JwtService({ secret: 'google-test' }).sign({
        email: 'google.user@example.test',
        name: 'Google User',
        email_verified: true,
      });
      const tokenEndpoint = nock('https://www.googleapis.com')
        .post('/oauth2/v4/token')
        .matchHeader('content-type', 'application/x-www-form-urlencoded')
        .reply(200, { id_token: idToken });
      let rawBody: string;
      tokenEndpoint.on('request', (_req, _interceptor, body) => (rawBody = body));

      const res = await request(server()).post('/api/v1/auth/signup-provider').send({ code: 'google-code' }).expect(201);
      expect(tokenEndpoint.isDone()).toBe(true);
      expect(rawBody).toBe(expectedBody);
      expect(res.body.data).toHaveExactProperties(['id', 'email', 'name', 'accessToken']);
      expect(res.body.data.id).toBe(existing.id);
      expect(decode(res.body.data.accessToken).sid).toBeUndefined();
      expect(await repo(UserIdentity).count()).toBe(0);
    });
  });
});
