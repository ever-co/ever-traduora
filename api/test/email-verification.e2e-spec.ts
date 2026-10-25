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

  const me = (user: TestingUser) => request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${user.accessToken}`);
  const verify = (token: string) => request(app.getHttpServer()).post('/api/v1/auth/verify-email').send({ token });
  const resend = (user: TestingUser) =>
    request(app.getHttpServer()).post('/api/v1/auth/resend-verification-email').set('Authorization', `Bearer ${user.accessToken}`);
  const invite = (email: string, role = 'editor') =>
    request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/invites`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email, role });
  const projectRole = async (user: TestingUser) => {
    const res = await request(app.getHttpServer()).get(`/api/v1/projects/${project.id}`).set('Authorization', `Bearer ${user.accessToken}`);
    return res.status === 200 ? res.body.data.role : undefined;
  };
  const users = () => app.get(Connection).getRepository(User);

  it('should start unverified and be verified by the link from the welcome email, once', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(false));

    expect(lastVerifyUrl).toMatch(/\/verify-email\?token=[0-9a-f]{64}$/);
    await verify(tokenOf(lastVerifyUrl))
      .expect(200)
      .expect(res => expect(res.body.data).toEqual({ email: 'new-user@test.com', emailVerified: true }));
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(true));

    await verify(tokenOf(lastVerifyUrl)).expect(404);
    await verify('0'.repeat(64)).expect(404);
  });

  it('should refuse an expired link', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    await users().update({ id: user.id }, { emailVerificationExpires: new Date(Date.now() - 1000) });

    await verify(tokenOf(lastVerifyUrl)).expect(404);
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(false));
  });

  it('should send a new link on request and stop the previous one', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    const firstUrl = lastVerifyUrl;

    await request(app.getHttpServer()).post('/api/v1/auth/resend-verification-email').expect(401);
    await resend(user).expect(204);
    expect(lastVerifyUrl).not.toEqual(firstUrl);

    await verify(tokenOf(firstUrl)).expect(404);
    await verify(tokenOf(lastVerifyUrl)).expect(200);

    // Nothing to send once verified
    lastVerifyUrl = undefined;
    await resend(user).expect(204);
    expect(lastVerifyUrl).toBeUndefined();
  });

  it('should make a changed email unverified and stop links sent to the old one', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com', false);
    const linkForOldEmail = lastVerifyUrl;

    let resetToken: string;
    jest.spyOn(app.get(MailService), 'passwordResetToken').mockImplementation(async (_, token) => {
      resetToken = token;
    });
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: 'new-user@test.com' }).expect(200);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ email: 'changed@Test.COM' })
      .expect(200)
      .expect(res => expect(res.body.data).toEqual({ id: user.id, name: user.name, email: 'changed@test.com', emailVerified: false }));

    // Neither link sent to the old email may vouch for the new one
    await verify(tokenOf(linkForOldEmail)).expect(404);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ email: 'changed@test.com', token: resetToken, newPassword: 'a-new-password' })
      .expect(401);
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(false));

    // The new email gets its own link
    expect(lastVerifyUrl).not.toEqual(linkForOldEmail);
    await verify(tokenOf(lastVerifyUrl)).expect(200);
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(true));
  });

  it('should make a verified email unverified when it changes', async () => {
    captureVerificationLinks();
    const user = await signupTestUser(app, 'new-user@test.com');
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(true));

    // Saving the same email again is not a change
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ email: 'new-user@test.com' })
      .expect(200);
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(true));

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ email: 'other@test.com' })
      .expect(200);
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(false));
  });

  it('should verify the email with a password reset', async () => {
    const user = await signupTestUser(app, 'new-user@test.com', false);
    let resetToken: string;
    jest.spyOn(app.get(MailService), 'passwordResetToken').mockImplementation(async (_, token) => {
      resetToken = token;
    });
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, token: resetToken, newPassword: 'a-new-password' })
      .expect(200);

    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(true));
  });

  it('should verify the email with a provider that verified it, and not otherwise', async () => {
    captureVerificationLinks();
    const signInWithProvider = (claims: object) => {
      const idToken = new JwtService({ secret: 'provider-test' }).sign({ email: 'provider-user@test.com', name: 'Provider User', ...claims });
      jest.spyOn(app.get(AuthService), 'getTokenFromGoogle').mockResolvedValue({ id_token: idToken });
      return request(app.getHttpServer()).post('/api/v1/auth/signup-provider').send({ code: 'provider-code' });
    };

    const {
      body: { data: user },
    } = await signInWithProvider({}).expect(201);
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(false));
    expect(lastVerifyUrl).toBeDefined();

    await signInWithProvider({ email_verified: true }).expect(201);
    await me(user)
      .expect(200)
      .expect(res => expect(res.body.data.emailVerified).toBe(true));
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

      await verify(tokenOf(linkFromWelcomeEmail)).expect(200);
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
