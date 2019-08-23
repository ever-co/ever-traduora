import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createAndMigrateApp } from './util';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createAndMigrateApp();
  });

  it('/health (GET)', async () => {
    await request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect(res => {
        expect(res.body).toHaveExactProperties(['status', 'version']);
        expect(res.body.status).toEqual('ok');
        expect(res.body.version).toMatch(require('semver-regex')());
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
