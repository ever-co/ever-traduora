import './util';

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

describe('LocaleController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;

  beforeAll(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
  });

  it('/api/v1/locales (GET) should return locales', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/locales')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toBeDefined();
        expect(res.body.data[0]).toHaveExactProperties(['code', 'region', 'language']);
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
