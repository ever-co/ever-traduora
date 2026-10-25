import { INestApplication } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { config } from '../src/config';
import { User } from '../src/entity/user.entity';
import { UserSeed } from '../src/seeds/user.seed';
import MailService from '../src/services/mail.service';
import * as publishedPasswords from '../src/utils/published-passwords';
import './util';
import { createAndMigrateApp, signupTestUser } from './util';

// Stands in for a published password such as the former default admin one, so this file does not contain it
const PUBLISHED_PASSWORD = 'a-password-everyone-knows';

describe('Published passwords and the default admin (e2e)', () => {
  let app: INestApplication;
  const originalAdminConfig = { ...config.defaultAdminCredentialConfig };

  beforeEach(async () => {
    jest.spyOn(publishedPasswords, 'isPublishedPassword').mockImplementation(password => password === PUBLISHED_PASSWORD);
    app = await createAndMigrateApp();
  });

  const login = (username: string, password: string) =>
    request(app.getHttpServer()).post('/api/v1/auth/token').send({ grant_type: 'password', username, password });

  const seedAdmin = (adminPassword: string) => {
    Object.assign(config.defaultAdminCredentialConfig, { adminEmail: 'admin@test.com', adminPassword, adminName: 'Admin' });
    return app.get(UserSeed).createDefaultAdmin();
  };

  // An account that an earlier version created with the published default password
  const setPasswordDirectly = async (email: string, password: string) => {
    const encryptedPassword = Buffer.from(await bcrypt.hash(password, 10), 'utf-8');
    await app.get(Connection).getRepository(User).update({ email }, { encryptedPassword });
  };

  it('should not create the default admin without TR_ADMIN_PASSWORD', async () => {
    expect(await seedAdmin('')).toBeNull();
    expect(await app.get(Connection).getRepository(User).findOneBy({ email: 'admin@test.com' })).toBeNull();
  });

  it('should not create the default admin with a published TR_ADMIN_PASSWORD', async () => {
    expect(await seedAdmin(PUBLISHED_PASSWORD)).toBeNull();
    expect(await app.get(Connection).getRepository(User).findOneBy({ email: 'admin@test.com' })).toBeNull();
  });

  it('should create the default admin with the configured password', async () => {
    expect(await seedAdmin('the-configured-admin-password')).not.toBeNull();
    await login('admin@test.com', 'the-configured-admin-password').expect(200);
  });

  it('should refuse a published password at signup and when changing or resetting a password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Someone', email: 'someone@test.com', password: PUBLISHED_PASSWORD })
      .expect(400)
      .expect(res => expect(res.body.error.code).toEqual('PublishedPassword'));
    // Other invalid input keeps the generic code
    await request(app.getHttpServer())
      .post('/api/v1/auth/signup')
      .send({ name: 'Someone', email: 'someone@test.com', password: 'short' })
      .expect(400)
      .expect(res => expect(res.body.error.code).toEqual('BadRequest'));

    const user = await signupTestUser(app);
    await request(app.getHttpServer())
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({ oldPassword: 'mysupersecretpassword', newPassword: PUBLISHED_PASSWORD })
      .expect(400);

    let resetToken: string;
    jest.spyOn(app.get(MailService), 'passwordResetToken').mockImplementation(async (_, token) => {
      resetToken = token;
    });
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, token: resetToken, newPassword: PUBLISHED_PASSWORD })
      .expect(400);

    await login(user.email, 'mysupersecretpassword').expect(200);
  });

  it('should remove a published password at sign-in and let the seed set the configured one', async () => {
    await signupTestUser(app, 'admin@test.com');
    await setPasswordDirectly('admin@test.com', PUBLISHED_PASSWORD);

    await login('admin@test.com', PUBLISHED_PASSWORD).expect(422);
    // The password is gone from the account, so it does not work a second time either
    await login('admin@test.com', PUBLISHED_PASSWORD).expect(422);

    expect(await seedAdmin('the-configured-admin-password')).toBeNull();
    await login('admin@test.com', 'the-configured-admin-password').expect(200);

    // Once the account has a password again, the seed leaves it alone
    await seedAdmin('another-admin-password');
    await login('admin@test.com', 'another-admin-password').expect(401);
    await login('admin@test.com', 'the-configured-admin-password').expect(200);
  });

  it('should let the owner reset a removed published password', async () => {
    const user = await signupTestUser(app);
    await setPasswordDirectly(user.email, PUBLISHED_PASSWORD);
    await login(user.email, PUBLISHED_PASSWORD).expect(422);

    let resetToken: string;
    jest.spyOn(app.get(MailService), 'passwordResetToken').mockImplementation(async (_, token) => {
      resetToken = token;
    });
    await request(app.getHttpServer()).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ email: user.email, token: resetToken, newPassword: 'my-own-new-password' })
      .expect(200);

    await login(user.email, 'my-own-new-password').expect(200);
  });

  afterEach(async () => {
    Object.assign(config.defaultAdminCredentialConfig, originalAdminConfig);
    jest.restoreAllMocks();
    await app.get(Connection).close();
    await app.close();
  });
});
