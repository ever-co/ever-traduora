// The optional modules are chosen when app.module.ts is first loaded: switch the statistics on before anything imports it
process.env.TR_EVER_STATS_ENABLED = 'true';

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { EverInstance } from '../src/entity/ever-instance.entity';
import { User } from '../src/entity/user.entity';
import { EVER_INSTANCE_SETTINGS } from '../src/ever-instance/ever-instance.settings';
import { verifyBytes } from '../src/ever-instance/key-wrap';
import { EVER_STATS_CONFIG, readEverStatsConfig } from '../src/ever-stats/ever-stats.config';
import { EVER_STATS_AUTOSTART } from '../src/ever-stats/ever-stats-scheduler.service';
import { EVER_STATS_FETCH, StatsRequest } from '../src/ever-stats/ever-stats-sender.service';
import { StatsValidator } from '../src/ever-stats/ever-stats-validator';
import './util';
import { createAndMigrateAppWith, createTestProjectClient, signupTestUser, TestingProjectClient, TestingUser } from './util';

const OPERATOR_EMAIL = 'operator@traduora.test';

/** Values seeded into the instance that must never appear in a report. */
const CANARIES = {
  name: 'Zebulon Canary-Person',
  email: 'zebulon.canary@example.org',
  project: 'Quokka Canary Project',
  term: 'canary.term.okapi',
  translation: 'Narwhal canary translation',
};

describe('Anonymous usage statistics (e2e)', () => {
  let app: INestApplication;
  let operator: TestingUser;
  let otherUser: TestingUser;
  let client: TestingProjectClient;
  const requests: Array<{ url: string; init: StatsRequest }> = [];

  const server = () => app.getHttpServer();
  const asOperator = (call: request.Test) => call.set('Authorization', `Bearer ${operator.accessToken}`);

  beforeAll(async () => {
    app = await createAndMigrateAppWith([
      { provide: EVER_STATS_AUTOSTART, useValue: false },
      {
        provide: EVER_STATS_FETCH,
        useValue: async (url: string, init: StatsRequest) => {
          requests.push({ url, init });
          return { status: 202 };
        },
      },
      { provide: EVER_INSTANCE_SETTINGS, useValue: { installSource: 'self-hosted', adminEmails: [OPERATOR_EMAIL], secret: 'e2e-statistics-secret' } },
      { provide: EVER_STATS_CONFIG, useValue: { ...readEverStatsConfig(), apiUrl: 'http://mock-platform:8080' } },
    ]);

    operator = await signupTestUser(app, OPERATOR_EMAIL);
    const signup = await request(server())
      .post('/api/v1/auth/signup')
      .send({ name: CANARIES.name, email: CANARIES.email, password: 'mysupersecretpassword' });
    otherUser = signup.body.data;
    // As if they had opened the link of the welcome e-mail
    await app.get(Connection).getRepository(User).update({ id: otherUser.id }, { emailVerified: true });

    const project = await request(server())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .send({ name: CANARIES.project })
      .expect(201);
    const projectId = project.body.data.id;
    const term = await request(server())
      .post(`/api/v1/projects/${projectId}/terms`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .send({ value: CANARIES.term })
      .expect(201);
    await request(server())
      .post(`/api/v1/projects/${projectId}/translations`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .send({ code: 'fr' })
      .expect(201);
    await request(server())
      .patch(`/api/v1/projects/${projectId}/translations/fr`)
      .set('Authorization', `Bearer ${otherUser.accessToken}`)
      .send({ termId: term.body.data.id, value: CANARIES.translation })
      .expect(200);
    client = await createTestProjectClient(app, otherUser, project.body.data);
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
  });

  it('answers the health check to anyone', async () => {
    await request(server())
      .get('/api/v1/ever-stats/health')
      .expect(200)
      .expect(res => expect(res.body.data).toEqual({ module: 'ever-stats', loaded: true }));
  });

  it('keeps every other route to the operator', async () => {
    await request(server()).get('/api/v1/ever-stats/status').expect(401);
    for (const token of [otherUser.accessToken, client.accessToken]) {
      await request(server()).get('/api/v1/ever-stats/status').set('Authorization', `Bearer ${token}`).expect(404);
      await request(server()).post('/api/v1/ever-stats/preview').set('Authorization', `Bearer ${token}`).expect(404);
      await request(server()).get('/api/v1/ever-stats/reports').set('Authorization', `Bearer ${token}`).expect(404);
      await request(server()).post('/api/v1/ever-stats/send').set('Authorization', `Bearer ${token}`).expect(404);
      await request(server()).put('/api/v1/ever-stats/enabled').set('Authorization', `Bearer ${token}`).send({ enabled: false }).expect(404);
      await request(server()).post('/api/v1/ever-stats/reset-identity').set('Authorization', `Bearer ${token}`).expect(404);
    }
    expect(requests).toHaveLength(0);
  });

  it('previews the report without sending it, and it names nobody', async () => {
    const res = await asOperator(request(server()).post('/api/v1/ever-stats/preview')).expect(200);
    const { valid, payload } = res.body.data;
    expect(valid).toBe(true);
    expect(payload.product).toBe('traduora');
    expect(payload.country).toBe('ZZ');
    expect(payload.counts).toMatchObject({ users: 2, projects: 1, terms: 1, locales: 1, project_clients: 1 });
    expect(payload.counts.translations).toBeGreaterThanOrEqual(1);
    expect(payload.aggregates.translations_changed).toBeGreaterThanOrEqual(1);
    expect(new StatsValidator().checkBytes(Buffer.from(JSON.stringify(payload)), 'traduora').ok).toBe(true);

    const text = JSON.stringify(payload);
    for (const canary of [...Object.values(CANARIES), OPERATOR_EMAIL, client.id, client.name, operator.id, otherUser.id]) {
      expect(text).not.toContain(canary);
    }
    expect(requests).toHaveLength(0);
  });

  it('shows the operator the state of the statistics', async () => {
    const res = await asOperator(request(server()).get('/api/v1/ever-stats/status')).expect(200);
    expect(res.body.data).toMatchObject({
      enabled: true,
      reason: 'env',
      toggleEnabled: true,
      keyState: 'ok',
      country: 'ZZ',
      installSource: 'self-hosted',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/v1:[A-Za-z0-9_-]+:/);
  });

  it('sends one signed report on request, and keeps its exact bytes', async () => {
    const res = await asOperator(request(server()).post('/api/v1/ever-stats/send')).expect(200);
    expect(res.body.data.status).toBe('sent');
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0];
    expect(url).toBe('http://mock-platform:8080/v1/stats/reports');

    const identity = await app
      .get(Connection)
      .getRepository(EverInstance)
      .findOne({ where: { id: 'self' } });
    expect(init.headers['Ever-Stats-Key']).toBe(identity.statsPublicKey);
    const signature = Buffer.from(init.headers['Ever-Stats-Signature'].replace(/^ed25519=/, ''), 'base64url');
    expect(verifyBytes(identity.statsPublicKey, init.body, signature)).toBe(true);
    expect(JSON.parse(init.body.toString('utf8')).instance_id).toBe(identity.instanceId);

    const reports = await asOperator(request(server()).get('/api/v1/ever-stats/reports')).expect(200);
    expect(reports.body.data).toHaveLength(1);
    expect(reports.body.data[0].payload).toBe(init.body.toString('utf8'));
    expect(reports.body.data[0].httpStatus).toBe(202);
  });

  it('lets Send now be used once per 10 minutes', async () => {
    await asOperator(request(server()).post('/api/v1/ever-stats/send'))
      .expect(429)
      .expect(res => expect(res.body.error.code).toBe('rate_limited'));
    expect(requests).toHaveLength(1);
  });

  it('sends nothing once the operator turned the statistics off', async () => {
    await asOperator(request(server()).put('/api/v1/ever-stats/enabled')).send({ enabled: 'no' }).expect(400);
    await asOperator(request(server()).put('/api/v1/ever-stats/enabled'))
      .send({ enabled: false })
      .expect(200)
      .expect(res => expect(res.body.data).toEqual({ enabled: false }));

    const status = await asOperator(request(server()).get('/api/v1/ever-stats/status')).expect(200);
    expect(status.body.data).toMatchObject({ enabled: false, reason: 'ui' });

    const identity = await app
      .get(Connection)
      .getRepository(EverInstance)
      .findOne({ where: { id: 'self' } });
    expect(identity.statsEnabledUi).toBe(false);
    expect(identity.statsEnabledChangedBy).toBe(operator.id);

    await asOperator(request(server()).post('/api/v1/ever-stats/send'))
      .expect(409)
      .expect(res => expect(res.body.error.code).toBe('stats_disabled'));
    expect(requests).toHaveLength(1);
  });

  it('resets the identity: a new instance id and key, and no history', async () => {
    const before = await app
      .get(Connection)
      .getRepository(EverInstance)
      .findOne({ where: { id: 'self' } });
    const res = await asOperator(request(server()).post('/api/v1/ever-stats/reset-identity')).expect(200);
    expect(res.body.data.instanceId).not.toBe(before.instanceId);
    expect(res.body.data.publicKey).not.toBe(before.statsPublicKey);
    expect(res.body.data.resetCount).toBe(1);
    expect(JSON.stringify(res.body)).not.toMatch(/v1:[A-Za-z0-9_-]+:/);

    const reports = await asOperator(request(server()).get('/api/v1/ever-stats/reports')).expect(200);
    expect(reports.body.data).toEqual([]);
  });
});
