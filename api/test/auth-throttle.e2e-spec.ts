import { INestApplication } from '@nestjs/common';
import * as moment from 'moment';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { config } from '../src/config';
import { User } from '../src/entity/user.entity';
import MailService from '../src/services/mail.service';
import './util';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

// The password reset routes take the limit of the other auth routes: TR_AUTH_THROTTLE_LIMIT requests per
// TR_AUTH_THROTTLE_TTL from one address (10 per minute outside production). On top of it, an account gets one reset
// email per TR_PASSWORD_RESET_COOLDOWN seconds (60 by default), whoever asks for it.
describe('Password reset rate limits (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let resetTokens: string[];
  let resetRecipients: string[];

  const limit = config.throttle.auth.limit;
  const { cooldownSeconds } = config.passwordReset;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    resetTokens = [];
    resetRecipients = [];
    jest.spyOn(app.get(MailService), 'passwordResetToken').mockImplementation(async (user, token) => {
      resetTokens.push(token);
      resetRecipients.push(user.email);
    });
  });

  const forgotPassword = (email: string) => request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email });
  const resetPassword = (token: string, newPassword = 'mynewpassword', email = testingUser.email) =>
    request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ email, token, newPassword });
  const signIn = (password: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/token').send({ grant_type: 'password', username: testingUser.email, password });

  // Moves the time the account's reset link was sent back by this many seconds, as if they had passed
  const sentSecondsEarlier = async (email: string, seconds: number) => {
    const users = app.get(Connection).getRepository(User);
    const { id, passwordResetExpires } = await users.findOneByOrFail({ email });
    await users.update({ id }, { passwordResetExpires: moment(passwordResetExpires).subtract(seconds, 'seconds').toDate() });
  };

  it('/api/v1/auth/forgot-password (POST) answers 429 past the limit, without an email or a new link', async () => {
    // Without the cooldown (TR_PASSWORD_RESET_COOLDOWN=0) every request sends an email, so only the limit holds them back
    config.passwordReset.cooldownSeconds = 0;

    for (let i = 0; i < limit; i++) {
      await forgotPassword(testingUser.email).expect(200);
    }

    await forgotPassword(testingUser.email).expect(429);
    // An unknown email gets the same answer, so emails cannot be probed past the limit either
    await forgotPassword('nobody@test.com').expect(429);

    expect(resetTokens).toHaveLength(limit);
    // The link of the last email still works: the refused requests did not replace it
    await resetPassword(resetTokens[limit - 1]).expect(200);
    await signIn('mynewpassword').expect(200);
  });

  it('/api/v1/auth/reset-password (POST) answers 429 past the limit, even to the right token', async () => {
    await forgotPassword(testingUser.email).expect(200);
    const [token] = resetTokens;

    for (let i = 0; i < limit; i++) {
      await resetPassword(`wrong-token-${i}`).expect(401);
    }

    await resetPassword(token).expect(429);

    // The password did not change
    await signIn('mynewpassword').expect(401);
    await signIn('mysupersecretpassword').expect(200);
  });

  it('/api/v1/auth/forgot-password (POST) sends one email for two requests within the cooldown, and its link still works', async () => {
    const first = await forgotPassword(testingUser.email).expect(200);
    const second = await forgotPassword(testingUser.email).expect(200);

    // The same answer, so the caller cannot tell that no email went out
    expect(second.body).toEqual(first.body);
    expect(resetTokens).toHaveLength(1);
    await resetPassword(resetTokens[0]).expect(200);
    await signIn('mynewpassword').expect(200);
  });

  it('/api/v1/auth/forgot-password (POST) sends one email for requests made at the same time', async () => {
    const responses = await Promise.all(Array.from({ length: 5 }, () => forgotPassword(testingUser.email)));

    expect(responses.map(res => res.status)).toEqual([200, 200, 200, 200, 200]);
    expect(resetTokens).toHaveLength(1);
    await resetPassword(resetTokens[0]).expect(200);
  });

  it('/api/v1/auth/forgot-password (POST) sends a new email once the cooldown has passed, which voids the link before', async () => {
    await forgotPassword(testingUser.email).expect(200);
    await sentSecondsEarlier(testingUser.email, cooldownSeconds);
    await forgotPassword(testingUser.email).expect(200);

    expect(resetTokens).toHaveLength(2);
    await resetPassword(resetTokens[0]).expect(401);
    await resetPassword(resetTokens[1]).expect(200);
    await signIn('mynewpassword').expect(200);
  });

  it('/api/v1/auth/forgot-password (POST) does not hold back the email of another account', async () => {
    const other = await signupTestUser(app, 'other-e2e@test.com');

    await forgotPassword(testingUser.email).expect(200);
    await forgotPassword(other.email).expect(200);
    await forgotPassword(testingUser.email).expect(200);

    expect(resetRecipients).toEqual([testingUser.email, other.email]);
    await resetPassword(resetTokens[0]).expect(200);
    await resetPassword(resetTokens[1], 'othernewpassword', other.email).expect(200);
  });

  it('/api/v1/auth/forgot-password (POST) sends the next email at once after the link was used', async () => {
    await forgotPassword(testingUser.email).expect(200);
    await resetPassword(resetTokens[0]).expect(200);

    await forgotPassword(testingUser.email).expect(200);

    expect(resetTokens).toHaveLength(2);
    await resetPassword(resetTokens[1], 'mynewerpassword').expect(200);
    await signIn('mynewerpassword').expect(200);
  });

  afterEach(async () => {
    config.passwordReset.cooldownSeconds = cooldownSeconds;
    jest.restoreAllMocks();
    await app.get(Connection).close();
    await app.close();
  });
});
