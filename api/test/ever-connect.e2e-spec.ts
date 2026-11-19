// The optional modules are chosen when app.module.ts is first loaded: switch the connection on before anything imports it
process.env.TR_EVER_CONNECT_ENABLED = 'true';
// The statistics (on by default) stay off here: this suite talks to a local fake platform only
process.env.TR_EVER_STATS_ENABLED = 'false';

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { EverConnectConnection } from '../src/entity/ever-connect-connection.entity';
import { EVER_CONNECT_CLIENT_FACTORY } from '../src/ever-connect/ever-connect-platform.client';
import { EVER_CONNECT_AUTOSTART } from '../src/ever-connect/ever-connect-scheduler.service';
import { EVER_CONNECT_SETTINGS, readEverConnectSettings } from '../src/ever-connect/ever-connect.settings';
import { EVER_INSTANCE_SETTINGS } from '../src/ever-instance/ever-instance.settings';
import { FakeEverPlatform } from './fake-ever-platform';
import './util';
import { createAndMigrateAppWith, createTestProject, createTestProjectClient, signupTestUser, TestingProjectClient, TestingUser } from './util';

const OPERATOR_EMAIL = 'operator@traduora.test';

describe('Ever Platform connection (e2e)', () => {
  let app: INestApplication;
  let operator: TestingUser;
  let otherUser: TestingUser;
  let client: TestingProjectClient;
  const platform = new FakeEverPlatform();

  const server = () => app.getHttpServer();
  const asOperator = (call: request.Test) => call.set('Authorization', `Bearer ${operator.accessToken}`);

  beforeAll(async () => {
    app = await createAndMigrateAppWith([
      { provide: EVER_CONNECT_AUTOSTART, useValue: false },
      { provide: EVER_CONNECT_CLIENT_FACTORY, useValue: platform.factory },
      { provide: EVER_CONNECT_SETTINGS, useValue: { ...readEverConnectSettings(), apiUrl: 'http://127.0.0.1:8080' } },
      { provide: EVER_INSTANCE_SETTINGS, useValue: { installSource: 'self-hosted', adminEmails: [OPERATOR_EMAIL], secret: 'e2e-connection-secret' } },
    ]);
    operator = await signupTestUser(app, OPERATOR_EMAIL);
    otherUser = await signupTestUser(app, 'translator@traduora.test');
    const project = await createTestProject(app, otherUser);
    client = await createTestProjectClient(app, otherUser, project);
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
  });

  it('answers the health check to anyone, and calls nothing before an operator connects', async () => {
    await request(server())
      .get('/api/v1/ever-connect/health')
      .expect(200)
      .expect(res => expect(res.body.data).toEqual({ module: 'ever-connect', loaded: true }));
    expect(platform.calls).toEqual([]);
  });

  it('keeps every other route to the operator', async () => {
    await request(server()).get('/api/v1/ever-connect/status').expect(401);
    for (const token of [otherUser.accessToken, client.accessToken]) {
      await request(server()).get('/api/v1/ever-platform/status').set('Authorization', `Bearer ${token}`).expect(404);
      await request(server()).get('/api/v1/ever-connect/status').set('Authorization', `Bearer ${token}`).expect(404);
      await request(server())
        .post('/api/v1/ever-connect/connect')
        .set('Authorization', `Bearer ${token}`)
        .send({ code: 'EVC-TEST-0000-0001' })
        .expect(404);
      await request(server()).post('/api/v1/ever-connect/disconnect').set('Authorization', `Bearer ${token}`).expect(404);
      await request(server()).get('/api/v1/ever-connect/audit').set('Authorization', `Bearer ${token}`).expect(404);
    }
    expect(platform.calls).toEqual([]);
  });

  it('tells the web app which pages the operator has', async () => {
    await asOperator(request(server()).get('/api/v1/ever-platform/status'))
      .expect(200)
      .expect(res => expect(res.body.data).toEqual({ stats: false, connect: true }));
  });

  it('connects with a code, then shows the connection without any key', async () => {
    await asOperator(request(server()).post('/api/v1/ever-connect/connect')).send({ code: 'nope' }).expect(400);
    const res = await asOperator(request(server()).post('/api/v1/ever-connect/connect'))
      .send({ code: 'EVC-TEST-0000-0001', displayName: 'Our translations' })
      .expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject({ connected: true, status: 'active', displayName: 'Our translations' });
    expect(platform.names().filter(name => name === 'redeem')).toHaveLength(1);

    const status = await asOperator(request(server()).get('/api/v1/ever-connect/status')).expect(200);
    expect(status.body.data.entitlement.state).toBe('valid');
    expect(JSON.stringify(status.body)).not.toMatch(/v1:[A-Za-z0-9_-]+:|privateKey|jws/);

    const row = await app
      .get(Connection)
      .getRepository(EverConnectConnection)
      .findOne({ where: { id: 'self' } });
    expect(row.connectedBy).toBe(`user:${operator.id}`);
    expect(row.connectPrivateKeyEnc.startsWith('v1:')).toBe(true);
  });

  it('lists the integrations with what they move, and links to app.ever.co for consent', async () => {
    const list = await asOperator(request(server()).get('/api/v1/ever-connect/integrations')).expect(200);
    expect(list.body.data.map(item => item.key)).toEqual(['instance_url', 'stats_link', 'ever_id_login', 'managed_operations']);
    expect(list.body.data[0].scope.length).toBeGreaterThan(0);
    await asOperator(request(server()).get('/api/v1/ever-connect/integrations/instance_url/consent-url'))
      .expect(200)
      .expect(res => expect(res.body.data.url).toBe('https://app.ever.co/consent/instance_url'));
    await asOperator(request(server()).get('/api/v1/ever-connect/integrations/payroll/consent-url')).expect(404);
    await asOperator(request(server()).put('/api/v1/ever-connect/public-url'))
      .send({ url: 'https://translate.example.com' })
      .expect(409)
      .expect(res => expect(res.body.error.code).toBe('consent_required'));
  });

  it('disconnects, and the audit trail names users by id only', async () => {
    await asOperator(request(server()).post('/api/v1/ever-connect/disconnect'))
      .expect(200)
      .expect(res => expect(res.body.data).toMatchObject({ connected: false, status: 'disconnected' }));
    const audit = await asOperator(request(server()).get('/api/v1/ever-connect/audit')).expect(200);
    const actions = audit.body.data.map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining(['instance.connect', 'instance.disconnect']));
    expect(JSON.stringify(audit.body)).not.toContain(OPERATOR_EMAIL);
  });
});
