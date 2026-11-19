// The statistics are on by default: this suite switches them off before the configuration is read
process.env.TR_EVER_STATS_ENABLED = 'false';

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { config } from '../src/config';
import { EverInstance } from '../src/entity/ever-instance.entity';
import { EverStatsReport } from '../src/entity/ever-stats-report.entity';
import './util';
import { createAndMigrateApp, signupTestUser } from './util';

describe('Anonymous usage statistics left off (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createAndMigrateApp();
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
  });

  it('is off with TR_EVER_STATS_ENABLED=false', () => {
    expect(config.everPlatform.statsEnabled).toBe(false);
  });

  it('has no route', async () => {
    const operator = await signupTestUser(app, config.everPlatform.adminEmails[0]);
    for (const path of ['health', 'status', 'reports']) {
      const res = await request(app.getHttpServer()).get(`/api/v1/ever-stats/${path}`).set('Authorization', `Bearer ${operator.accessToken}`);
      // Without the module these are just unknown paths: never an answer of the statistics routes
      expect(res.body?.data).toBeUndefined();
    }
    for (const path of ['preview', 'send', 'reset-identity']) {
      await request(app.getHttpServer()).post(`/api/v1/ever-stats/${path}`).set('Authorization', `Bearer ${operator.accessToken}`).expect(404);
    }
    await request(app.getHttpServer())
      .put('/api/v1/ever-stats/enabled')
      .set('Authorization', `Bearer ${operator.accessToken}`)
      .send({ enabled: true })
      .expect(404);
  });

  it('creates no identity and keeps no report', async () => {
    const connection = app.get(Connection);
    expect(await connection.getRepository(EverInstance).count()).toBe(0);
    expect(await connection.getRepository(EverStatsReport).count()).toBe(0);
  });
});
