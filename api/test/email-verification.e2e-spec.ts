import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { Invite, InviteStatus } from '../src/entity/invite.entity';
import { User } from '../src/entity/user.entity';
import { AuthService } from '../src/services/auth.service';
import MailService from '../src/services/mail.service';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('Email verification (e2e)', () => {
  let app: INestApplication;
  let admin: TestingUser;
  let project: TestingProject;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    admin = await signupTestUser(app, 'admin@test.com');
    project = await createTestProject(app, admin);
  });

  // The verification link from the last welcome or verification email
  let lastVerifyUrl: string | undefined;
  const captureVerificationLinks = () => {
    lastVerifyUrl = undefined;
    const mail = app.get(MailService);
    jest.spyOn(mail, 'welcomeNewUser').mockImplementation(async (_, url) => {
      lastVerifyUrl = url;
    });
    jest.spyOn(mail, 'verifyEmail').mockImplementation(async (_, url) => {
      lastVerifyUrl = url;
    });
  };
  const tokenOf = (url: string) => new URL(url).searchParams.get('token');

  let resetToken: string | undefined;
  const capturePasswordResetTokens = () =>
    jest.spyOn(app.get(MailService), 'passwordResetToken').mockImplementation(async (_, token) => {
      resetToken = token;
    });

  // A session opened a minute ago, i.e. before anything this test does to the account
  const earlierSession = (user: { id: string }) => ({
    accessToken: app.get(JwtService).sign({ sub: user.id, type: 'user', iat: Math.floor(Date.now() / 1000) - 60 }),
  });

  const me = (user: { accessToken: string }) =>
    request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${user.accessToken}`);
  const verify = (user: { accessToken: string }, token: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/verify-email').set('Authorization', `Bearer ${user.accessToken}`).send({ token });
  const resend = (user: TestingUser) =>
    request(app.getHttpServer()).post('/api/v1/auth/resend-verification-email').set('Authorization', `Bearer ${user.accessToken}`);
  const login = (email: string, password = 'mysupersecretpassword') =>
    request(app.getHttpServer()).post('/api/v1/auth/token').send({ grant_type: 'password', username: email, password });
  const resetPassword = async (email: string, newPassword: string) => {
    capturePasswordResetTokens();
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email }).expect(200);
    await request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ email, token: resetToken, newPassword }).expect(200);
  };
  const signInWithProvider = (email: string, claims: object) => {
    const idToken = new JwtService({ secret: 'provider-test' }).sign({ email, name: 'Provider User', ...claims });
    jest.spyOn(app.get(AuthService), 'getTokenFromGoogle').mockResolvedValue({ id_token: idToken });
    return request(app.getHttpServer()).post('/api/v1/auth/signup-provider').send({ code: 'provider-code' });
  };
  const invite = (email: string, role = 'editor') =>
    request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/invites`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email, role });
  const projectRole = async (user: { accessToken: string }) => {
    const res = await request(app.getHttpServer()).get(`/api/v1/projects/${project.id}`).set('Authorization', `Bearer ${user.accessToken}`);
    return res.status === 200 ? res.body.data.role : undefined;
  };
  const emailVerified = async (user: { accessToken: string }) => (await me(user).expect(200)).body.data.emailVerified;
  const users = () => app.get(Connection).getRepository(User);

  it('should start unverified and be verified by the link from the welcome email, once', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    expect(await emailVerified(user)).toBe(false);

    expect(lastVerifyUrl).toMatch(/\/verify-email\?token=[0-9a-f]{64}$/);
    await verify(user, tokenOf(lastVerifyUrl))
      .expect(200)
      .expect(res => expect(res.body.data).toEqual({ email: 'new-user@test.com', emailVerified: true }));
    expect(await emailVerified(user)).toBe(true);

    await verify(user, tokenOf(lastVerifyUrl)).expect(404);
    await verify(user, '0'.repeat(64)).expect(404);
  });

  it('should only verify the account the link was sent for, while signed in to it', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    const link = lastVerifyUrl;

    // e.g. the owner of a mailbox that someone else registered an account with
    await request(app.getHttpServer())
      .post('/api/v1/auth/verify-email')
      .send({ token: tokenOf(link) })
      .expect(401);
    await verify(admin, tokenOf(link)).expect(404);
    expect(await emailVerified(user)).toBe(false);
    expect(await emailVerified(admin)).toBe(true);

    await verify(user, tokenOf(link)).expect(200);
  });

  it('should refuse an expired link', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    await users().update({ id: user.id }, { emailVerificationExpires: new Date(Date.now() - 1000) });

    await verify(user, tokenOf(lastVerifyUrl)).expect(404);
    expect(await emailVerified(user)).toBe(false);
  });

  it('should send a new link on request and stop the previous one', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    const firstUrl = lastVerifyUrl;

    await request(app.getHttpServer()).post('/api/v1/auth/resend-verification-email').expect(401);
    await resend(user).expect(204);
    expect(lastVerifyUrl).not.toEqual(firstUrl);

    await verify(user, tokenOf(firstUrl)).expect(404);
    await verify(user, tokenOf(lastVerifyUrl)).expect(200);

    // Nothing to send once verified
    lastVerifyUrl = undefined;
    await resend(user).expect(204);
    expect(lastVerifyUrl).toBeUndefined();
  });

  it('should make a changed email unverified and stop links sent to the old one', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    const linkForOldEmail = lastVerifyUrl;

    capturePasswordResetTokens();
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'new-user@test.com' }).expect(200);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ email: 'changed@Test.COM' })
      .expect(200)
      .expect(res => expect(res.body.data).toEqual({ id: user.id, name: user.name, email: 'changed@test.com', emailVerified: false }));

    // Neither link sent to the old email may vouch for the new one
    await verify(user, tokenOf(linkForOldEmail)).expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ email: 'changed@test.com', token: resetToken, newPassword: 'a-new-password' })
      .expect(401);
    expect(await emailVerified(user)).toBe(false);

    // The new email gets its own link
    expect(lastVerifyUrl).not.toEqual(linkForOldEmail);
    await verify(user, tokenOf(lastVerifyUrl)).expect(200);
    expect(await emailVerified(user)).toBe(true);
  });

  it('should make a verified email unverified when it changes', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com');
    expect(await emailVerified(user)).toBe(true);

    // Saving the same email again is not a change
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ email: 'new-user@test.com' })
      .expect(200);
    expect(await emailVerified(user)).toBe(true);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ email: 'other@test.com' })
      .expect(200);
    expect(await emailVerified(user)).toBe(false);
  });

  it('should verify the email, accept pending invites and end earlier sessions with a password reset', async () => {
    const user = await signupTestUser(app, 'new-user@test.com', false);
    const earlier = earlierSession(user);
    await invite('new-user@test.com', 'viewer').expect(201);

    await resetPassword(user.email, 'a-new-password');

    // e.g. the sessions of someone who registered this email before its owner
    await me(earlier).expect(401);
    const {
      body: { access_token: accessToken },
    } = await login(user.email, 'a-new-password').expect(200);
    expect(await emailVerified({ accessToken })).toBe(true);
    expect(await projectRole({ accessToken })).toEqual('viewer');
  });

  describe('with a provider sign-in', () => {
    it('should verify a new account only when the provider verified the email', async () => {
      captureVerificationLinks();
      const {
        body: { data: unverified },
      } = await signInWithProvider('provider-user@test.com', {}).expect(201);
      expect(await emailVerified(unverified)).toBe(false);
      expect(lastVerifyUrl).toBeDefined();

      lastVerifyUrl = undefined;
      const {
        body: { data: verified },
      } = await signInWithProvider('other-provider-user@test.com', { email_verified: true }).expect(201);
      expect(await emailVerified(verified)).toBe(true);
      expect(lastVerifyUrl).toBeUndefined();
    });

    it('should not sign in to an existing account when the provider has not verified the email', async () => {
      await signupTestUser(app, 'member@test.com');
      await signInWithProvider('member@test.com', {}).expect(401);
      await signInWithProvider('member@test.com', { email_verified: false }).expect(401);
      await login('member@test.com').expect(200);
    });

    it('should keep the password of an account whose email was verified already', async () => {
      await signupTestUser(app, 'member@test.com');
      await signInWithProvider('member@test.com', { email_verified: true }).expect(201);
      await login('member@test.com').expect(200);
    });

    it('should remove the password and end the sessions of an unverified account it claims', async () => {
      // Someone registered the owner's email with a password they chose
      const squatter = await signupTestUser(app, 'member@test.com', false);
      const squatterSession = earlierSession(squatter);
      await invite('member@test.com').expect(201);

      const {
        body: { data: owner },
      } = await signInWithProvider('member@test.com', { email_verified: true }).expect(201);
      expect(owner.id).toEqual(squatter.id);

      await me(squatterSession).expect(401);
      await login('member@test.com').expect(422);
      expect(await emailVerified(owner)).toBe(true);
      expect(await projectRole(owner)).toEqual('editor');
    });
  });

  describe('inviting an existing account', () => {
    it('should add an account with a verified email directly', async () => {
      const user = await signupTestUser(app, 'member@test.com');
      await invite('member@test.com')
        .expect(201)
        .expect(res => expect(res.body.data).toHaveExactProperties(['userId', 'email', 'name', 'role']));
      expect(await projectRole(user)).toEqual('editor');
    });

    it('should only send an invite link to an account with an unverified email', async () => {
      // e.g. someone registered this email before it was invited
      const squatter = await signupTestUser(app, 'member@test.com', false);

      const {
        body: { data: created },
      } = await invite('member@test.com')
        .expect(201)
        .expect(res => expect(res.body.data).toHaveExactProperties(['id', 'email', 'status', 'role', 'inviteUrl']));
      expect(await projectRole(squatter)).toBeUndefined();

      // Without the link the account gets nothing; the one who reads the invitation email accepts it
      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .set('Authorization', `Bearer ${squatter.accessToken}`)
        .send({ inviteToken: '0'.repeat(64) })
        .expect(404);
      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .set('Authorization', `Bearer ${squatter.accessToken}`)
        .send({ inviteToken: new URL(created.inviteUrl).searchParams.get('invite') })
        .expect(200);
      expect(await projectRole(squatter)).toEqual('editor');
    });

    it('should accept pending invites once the email is verified', async () => {
      captureVerificationLinks();
      const user = await signupTestUser(app, 'member@test.com', false);
      const linkFromWelcomeEmail = lastVerifyUrl;

      await invite('member@test.com', 'viewer').expect(201);
      expect(await projectRole(user)).toBeUndefined();

      await verify(user, tokenOf(linkFromWelcomeEmail)).expect(200);
      expect(await projectRole(user)).toEqual('viewer');
      const invites = await app
        .get(Connection)
        .getRepository(Invite)
        .find({ where: { email: 'member@test.com' } });
      expect(invites.map(i => i.status)).toEqual([InviteStatus.Accepted]);
    });

    it('should not invite an unverified account that is already a member', async () => {
      const user = await signupTestUser(app, 'member@test.com');
      await invite('member@test.com').expect(201);
      await users().update({ id: user.id }, { emailVerified: false });

      await invite('member@test.com').expect(409);
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.get(Connection).close();
    await app.close();
  });
});
