// The optional modules are chosen when app.module.ts is first loaded: switch the connection on before anything imports it
process.env.TR_EVER_CONNECT_ENABLED = 'true';
// The statistics (on by default) stay off here: this suite talks to a local fake platform only
process.env.TR_EVER_STATS_ENABLED = 'false';
// The Ever ID issuer this installation signs in with (sign-in itself stays off: the identities are written directly)
process.env.TR_AUTH_EVERID_ISSUER = 'https://auth.ever.test';

import { generateKeyPairSync } from 'crypto';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { EverConnectAudit } from '../src/entity/ever-connect-audit.entity';
import { EverConnectProvision } from '../src/entity/ever-connect-provision.entity';
import { Project } from '../src/entity/project.entity';
import { IdentityLinkMethod, UserIdentity } from '../src/entity/user-identity.entity';
import { EVER_CONNECT_CLIENT_FACTORY } from '../src/ever-connect/ever-connect-platform.client';
import { EVER_CONNECT_AUTOSTART, EverConnectSchedulerService } from '../src/ever-connect/ever-connect-scheduler.service';
import { EVER_CONNECT_SETTINGS, readEverConnectSettings } from '../src/ever-connect/ever-connect.settings';
import { EVER_INSTANCE_SETTINGS } from '../src/ever-instance/ever-instance.settings';
import { FakeEverPlatform } from './fake-ever-platform';
import './util';
import { createAndMigrateAppWith, signupTestUser, TestingUser } from './util';

const OPERATOR_EMAIL = 'operator@traduora.test';
const ISSUER = 'https://auth.ever.test';
const BASE = '/api/v1/ever-connect/provision';

/** The app with the fake platform, the provisioning switch as given, and the operator connected. */
async function connectedApp(platform: FakeEverPlatform, provisionEnabled: boolean) {
  const app = await createAndMigrateAppWith([
    { provide: EVER_CONNECT_AUTOSTART, useValue: false },
    { provide: EVER_CONNECT_CLIENT_FACTORY, useValue: platform.factory },
    {
      provide: EVER_CONNECT_SETTINGS,
      useValue: { ...readEverConnectSettings(), apiUrl: 'http://127.0.0.1:8080', provisionEnabled, appUrl: 'https://translate.example.test' },
    },
    { provide: EVER_INSTANCE_SETTINGS, useValue: { installSource: 'self-hosted', adminEmails: [OPERATOR_EMAIL], secret: 'e2e-provision-secret' } },
  ]);
  const operator = await signupTestUser(app, OPERATOR_EMAIL);
  await request(app.getHttpServer())
    .post('/api/v1/ever-connect/connect')
    .set('Authorization', `Bearer ${operator.accessToken}`)
    .send({ code: 'EVC-TEST-0000-0001', displayName: 'Traduora cloud' })
    .expect(200);
  platform.calls.length = 0;
  return app;
}

describe('Ever Platform provisioning hand-off, switched on (e2e)', () => {
  let app: INestApplication;
  let alice: TestingUser;
  let bob: TestingUser;
  const platform = new FakeEverPlatform();

  const server = () => app.getHttpServer();
  const as = (user: TestingUser, call: request.Test) => call.set('Authorization', `Bearer ${user.accessToken}`);
  const projects = () => app.get(Connection).getRepository(Project).count();
  const answers = () => app.get(Connection).getRepository(EverConnectProvision);
  /** The sealed confirmation of an intent. */
  const txnOf = async (intent: string) =>
    (await request(server()).post(`${BASE}/intent`).send({ intent }).expect(200)).body.data.provisionTxn as string;

  beforeAll(async () => {
    app = await connectedApp(platform, true);
    alice = await signupTestUser(app, 'alice@traduora.test');
    bob = await signupTestUser(app, 'bob@traduora.test');
    // Alice signed in with her Ever ID (as the sign-in flow records it); Bob uses a password only
    const identities = app.get(Connection).getRepository(UserIdentity);
    await identities.save(
      identities.create({
        user: { id: alice.id },
        provider: 'everid',
        issuer: ISSUER,
        subject: 'alice-subject',
        everPersonId: 'person-alice',
        emailAtLink: alice.email,
        linkMethod: IdentityLinkMethod.Explicit,
        linkedAt: new Date(),
        lastLoginAt: null,
      }),
    );
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
  });

  it('checks an intent and creates nothing', async () => {
    const before = await projects();
    const intent = platform.intent();
    const res = await request(server()).post(`${BASE}/intent`).send({ intent }).expect(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.data).toMatchObject({ jti: platform.claimsOf(intent).jti, handle: 'acme', displayName: 'Acme Translations' });
    expect(typeof res.body.data.provisionTxn).toBe('string');
    // The sealed confirmation does not carry the intent, nor the subject in clear
    expect(res.body.data.provisionTxn).not.toContain(intent.split('.')[2]);
    expect(res.body.data.provisionTxn).not.toContain('alice-subject');
    expect(await projects()).toBe(before);
    expect(await answers().count()).toBe(0);
    expect(platform.names()).not.toContain('completeProvisionIntent');
  });

  it('refuses an intent that does not verify, is not for Traduora or this installation, or expired', async () => {
    const now = Math.floor(Date.now() / 1000);
    const cases: Array<[string, number, string]> = [
      ['not.an-intent', 400, 'invalid_intent'],
      [platform.intent({}, {}, generateKeyPairSync('ed25519').privateKey), 401, 'invalid_intent'],
      [platform.intent({}, { kid: 'unknown-key' }), 401, 'invalid_intent'],
      [platform.intent({}, { alg: 'none' }), 401, 'invalid_intent'],
      [platform.intent({ iss: 'https://elsewhere.test' }), 401, 'invalid_intent'],
      [platform.intent({ aud: 'ever-connect:rec' }), 401, 'wrong_audience'],
      [platform.intent({ mode: 'cloud' }), 401, 'invalid_intent'],
      [platform.intent({ iat: now, exp: now + 3600 }), 401, 'invalid_intent'],
      [platform.intent({ product: 'rec' }), 422, 'product_mismatch'],
      [platform.intent({ instance_id: '01JMQCKINSTANCE0000000000B' }), 422, 'instance_mismatch'],
      [platform.intent({ iat: now - 700, exp: now - 10 }), 409, 'intent_expired'],
    ];
    for (const [intent, status, code] of cases) {
      const res = await request(server()).post(`${BASE}/intent`).send({ intent });
      expect({ status: res.status, code: res.body.error && res.body.error.code }).toEqual({ status, code });
    }
    await request(server()).post(`${BASE}/intent`).send({}).expect(400);
  });

  it('refuses the confirmation of an account without that Ever ID, and of a signed-out caller', async () => {
    const before = await projects();
    const provisionTxn = await txnOf(platform.intent());
    const res = await as(bob, request(server()).post(`${BASE}/confirm`))
      .send({ provisionTxn })
      .expect(403);
    expect(res.body.error.code).toBe('intent_subject_mismatch');
    await request(server()).post(`${BASE}/confirm`).send({ provisionTxn }).expect(401);
    await as(alice, request(server()).post(`${BASE}/confirm`))
      .send({ provisionTxn: 'v1:not:a:confirmation' })
      .expect(400);
    expect(await projects()).toBe(before);
    expect(await answers().count()).toBe(0);
  });

  it('creates one project with the person as its admin, tells Ever Platform, and answers a replay with exists', async () => {
    const before = await projects();
    const intent = platform.intent();
    const { jti } = platform.claimsOf(intent);
    const provisionTxn = await txnOf(intent);

    const created = await as(alice, request(server()).post(`${BASE}/confirm`))
      .send({ provisionTxn })
      .expect(200);
    expect(created.body.data).toMatchObject({ status: 'created', returnTo: 'https://app.ever.test/start/done' });
    const projectId = created.body.data.projectId;
    expect(await projects()).toBe(before + 1);

    const mine = await as(alice, request(server()).get('/api/v1/projects')).expect(200);
    expect(mine.body.data).toEqual([expect.objectContaining({ id: projectId, name: 'Acme Translations', role: 'admin' })]);
    await as(bob, request(server()).get(`/api/v1/projects/${projectId}`)).expect(404);

    expect(platform.completions[jti]).toEqual({
      instance_id: '01JMQCKINSTANCE0000000000A',
      product_tenant_id: projectId,
      product_user_ref: alice.id,
      urls: { app: 'https://translate.example.test/' },
      result: 'created',
    });
    expect(JSON.stringify(platform.calls)).not.toContain('@traduora.test');
    expect(await answers().findOne({ where: { jti } })).toMatchObject({
      state: 'created',
      userId: alice.id,
      projectId,
      tenantLinkId: '01JMQCKLINK00000000000000P',
      pendingComplete: false,
    });

    // The same confirmation again: nothing new
    const replay = await as(alice, request(server()).post(`${BASE}/confirm`))
      .send({ provisionTxn })
      .expect(200);
    expect(replay.body.data).toMatchObject({ status: 'exists', projectId });
    expect(await projects()).toBe(before + 1);
    // The intent cannot start again
    const again = await request(server()).post(`${BASE}/intent`).send({ intent }).expect(409);
    expect(again.body.error.code).toBe('intent_consumed');
  });

  it('declines: nothing is created, Ever Platform is told, and the intent is used', async () => {
    const before = await projects();
    const intent = platform.intent();
    const { jti } = platform.claimsOf(intent);
    const provisionTxn = await txnOf(intent);

    await request(server()).post(`${BASE}/intents/another-jti/reject`).send({ provisionTxn }).expect(400);
    const declined = await request(server()).post(`${BASE}/intents/${jti}/reject`).send({ provisionTxn }).expect(200);
    expect(declined.body.data).toEqual({ status: 'refused', returnTo: 'https://app.ever.test/start/done' });
    expect(platform.completions[jti]).toEqual({ instance_id: '01JMQCKINSTANCE0000000000A', product_tenant_id: 'none', result: 'refused' });
    // Declining twice answers the same; confirming afterwards does not create anything
    await request(server()).post(`${BASE}/intents/${jti}/reject`).send({ provisionTxn }).expect(200);
    const late = await as(alice, request(server()).post(`${BASE}/confirm`))
      .send({ provisionTxn })
      .expect(409);
    expect(late.body.error.code).toBe('intent_consumed');
    expect(await projects()).toBe(before);
  });

  it('sends a completion Ever Platform could not receive at once from the background round', async () => {
    const intent = platform.intent();
    const { jti } = platform.claimsOf(intent);
    const provisionTxn = await txnOf(intent);
    platform.unreachable = true;
    const created = await as(alice, request(server()).post(`${BASE}/confirm`))
      .send({ provisionTxn })
      .expect(200);
    expect(created.body.data.status).toBe('created');
    expect(await answers().findOne({ where: { jti } })).toMatchObject({ pendingComplete: true });
    expect(platform.completions[jti]).toBeUndefined();

    platform.unreachable = false;
    await app.get(EverConnectSchedulerService).tick();
    expect(platform.completions[jti]).toMatchObject({ product_tenant_id: created.body.data.projectId, result: 'created' });
    expect(await answers().findOne({ where: { jti } })).toMatchObject({ pendingComplete: false });
  });

  it('records a completion Ever Platform no longer takes, and does not send it again', async () => {
    const intent = platform.intent();
    const { jti } = platform.claimsOf(intent);
    const provisionTxn = await txnOf(intent);
    platform.completeProblem = { status: 410, code: 'intent_expired' };
    await as(alice, request(server()).post(`${BASE}/confirm`))
      .send({ provisionTxn })
      .expect(200);
    expect(await answers().findOne({ where: { jti } })).toMatchObject({ pendingComplete: false, completeRefused: '410:intent_expired' });
    platform.calls.length = 0;
    await app.get(EverConnectSchedulerService).tick();
    expect(platform.names()).not.toContain('completeProvisionIntent');
  });

  it('records each answer in the audit trail without an e-mail', async () => {
    const rows = await app.get(Connection).getRepository(EverConnectAudit).find();
    const actions = rows.map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining(['provision.created', 'provision.refused']));
    expect(JSON.stringify(rows)).not.toContain('@traduora.test');
  });
});

describe('Ever Platform provisioning hand-off, switched off (e2e)', () => {
  let app: INestApplication;
  const platform = new FakeEverPlatform();

  beforeAll(async () => {
    app = await connectedApp(platform, false);
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
    // The suites after this one read their own configuration
    delete process.env.TR_AUTH_EVERID_ISSUER;
  });

  it('answers 404 on every provisioning route and calls nothing', async () => {
    const alice = await signupTestUser(app, 'alice@traduora.test');
    const intent = platform.intent();
    await request(app.getHttpServer()).post(`${BASE}/intent`).send({ intent }).expect(404);
    await request(app.getHttpServer())
      .post(`${BASE}/confirm`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ provisionTxn: 'x' })
      .expect(404);
    // Even signed out: the route does not answer at all
    await request(app.getHttpServer()).post(`${BASE}/confirm`).send({ provisionTxn: 'x' }).expect(404);
    await request(app.getHttpServer())
      .post(`${BASE}/intents/${platform.claimsOf(intent).jti}/reject`)
      .send({ provisionTxn: 'x' })
      .expect(404);
    expect(platform.names().filter(name => name === 'intentKey' || name === 'completeProvisionIntent')).toEqual([]);
    expect(await app.get(Connection).getRepository(EverConnectProvision).count()).toBe(0);
  });
});
