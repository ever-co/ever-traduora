import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { config } from '../src/config';
import MailService from '../src/services/mail.service';
import './util';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

// The password reset routes take the limit of the other auth routes: TR_AUTH_THROTTLE_LIMIT requests per
// TR_AUTH_THROTTLE_TTL from one address (10 per minute outside production)
describe('Password reset rate limits (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let resetTokens: string[];

  const limit = config.throttle.auth.limit;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    resetTokens = [];
    jest.spyOn(app.get(MailService), 'passwordResetToken').mockImplementation(async (_, token) => {
      resetTokens.push(token);
    });
  });

  const forgotPassword = (email: string) => request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email });
  const resetPassword = (token: string, newPassword = 'mynewpassword') =>
    request(app.getHttpServer()).post('/api/v1/auth/reset-password').send({ email: testingUser.email, token, newPassword });
  const signIn = (password: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/token').send({ grant_type: 'password', username: testingUser.email, password });

  it('/api/v1/auth/forgot-password (POST) answers 429 past the limit, without an email or a new link', async () => {
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

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.get(Connection).close();
    await app.close();
  });
});
