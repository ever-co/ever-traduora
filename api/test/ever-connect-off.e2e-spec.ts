// Both optional modules off: the connection is off by default, the statistics are switched off before the configuration
// is read (with them on, the instance identity and its status route would load)
process.env.TR_EVER_STATS_ENABLED = 'false';
delete process.env.TR_EVER_CONNECT_ENABLED;

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { config } from '../src/config';
import { EverConnectConnection } from '../src/entity/ever-connect-connection.entity';
import './util';
import { createAndMigrateApp, signupTestUser } from './util';

describe('Ever Platform connection left off (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createAndMigrateApp();
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
  });

  it('is off unless TR_EVER_CONNECT_ENABLED is true', () => {
    expect(config.everPlatform.connectEnabled).toBe(false);
    expect(config.everPlatform.statsEnabled).toBe(false);
  });

  it('has no route', async () => {
    const operator = await signupTestUser(app, config.everPlatform.adminEmails[0]);
    for (const path of [
      'ever-connect/health',
      'ever-connect/status',
      'ever-platform/status',
      'ever-connect/integrations',
      'ever-connect/me/exports',
    ]) {
      const res = await request(app.getHttpServer()).get(`/api/v1/${path}`).set('Authorization', `Bearer ${operator.accessToken}`);
      // Without the module these are just unknown paths: never an answer of the connection routes
      expect(res.body?.data).toBeUndefined();
    }
    for (const path of ['connect', 'disconnect', 'integrations/refresh']) {
      await request(app.getHttpServer())
        .post(`/api/v1/ever-connect/${path}`)
        .set('Authorization', `Bearer ${operator.accessToken}`)
        .send({ code: 'EVC-TEST-0000-0001' })
        .expect(404);
    }
  });

  it('stores no connection', async () => {
    expect(await app.get(Connection).getRepository(EverConnectConnection).count()).toBe(0);
  });
});
