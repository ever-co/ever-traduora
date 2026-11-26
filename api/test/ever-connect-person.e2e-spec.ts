// The optional modules are chosen when app.module.ts is first loaded: switch the connection on before anything imports it
process.env.TR_EVER_CONNECT_ENABLED = 'true';
// The statistics (on by default) stay off here: this suite talks to a local fake platform only
process.env.TR_EVER_STATS_ENABLED = 'false';

import { subjectHash } from '@ever-co/connect-sdk';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { EverConnectPersonExport } from '../src/entity/ever-connect-person-export.entity';
import { EverIdSession } from '../src/entity/ever-id-session.entity';
import { IdentityLinkMethod, UserIdentity } from '../src/entity/user-identity.entity';
import { User } from '../src/entity/user.entity';
import { EVER_CONNECT_CLIENT_FACTORY } from '../src/ever-connect/ever-connect-platform.client';
import { EVER_CONNECT_AUTOSTART, EverConnectSchedulerService } from '../src/ever-connect/ever-connect-scheduler.service';
import { EVER_CONNECT_SETTINGS, readEverConnectSettings } from '../src/ever-connect/ever-connect.settings';
import { EVER_INSTANCE_SETTINGS } from '../src/ever-instance/ever-instance.settings';
import { FakeEverPlatform } from './fake-ever-platform';
import './util';
import { createAndMigrateAppWith, createTestProject, createTestProjectClient, signupTestUser, TestingProjectClient, TestingUser } from './util';

const OPERATOR_EMAIL = 'operator@traduora.test';
const ISSUER = 'https://auth.ever.test';

describe("A person's Ever ID requests through the Ever Platform connection (e2e)", () => {
  let app: INestApplication;
  let operator: TestingUser;
  let alice: TestingUser;
  let bob: TestingUser;
  let client: TestingProjectClient;
  const platform = new FakeEverPlatform();

  const server = () => app.getHttpServer();
  const as = (user: { accessToken: string }, call: request.Test) => call.set('Authorization', `Bearer ${user.accessToken}`);
  const tick = () => app.get(EverConnectSchedulerService).tick();

  beforeAll(async () => {
    app = await createAndMigrateAppWith([
      { provide: EVER_CONNECT_AUTOSTART, useValue: false },
      { provide: EVER_CONNECT_CLIENT_FACTORY, useValue: platform.factory },
      // The feed is read at every round (the fake answers at once)
      // Exports switched on, at an https address; deletions left as they are by default (the accounts stay)
      {
        provide: EVER_CONNECT_SETTINGS,
        useValue: {
          ...readEverConnectSettings(),
          apiUrl: 'http://127.0.0.1:8080',
          feedMode: 'longpoll',
          personExportEnabled: true,
          appUrl: 'https://translate.example.test',
        },
      },
      { provide: EVER_INSTANCE_SETTINGS, useValue: { installSource: 'self-hosted', adminEmails: [OPERATOR_EMAIL], secret: 'e2e-person-secret' } },
    ]);
    operator = await signupTestUser(app, OPERATOR_EMAIL);
    alice = await signupTestUser(app, 'alice@traduora.test');
    bob = await signupTestUser(app, 'bob@traduora.test');
    const project = await createTestProject(app, alice);
    client = await createTestProjectClient(app, alice, project);

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
    await app
      .get(Connection)
      .getRepository(EverIdSession)
      .insert({ sid: 'alice-session', userId: alice.id, jti: 'j', issuedAt: new Date(), expiresAt: new Date(Date.now() + 3600000), revokedAt: null });
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
  });

  it('reports no person link before the connection and the ever_id_login consent', async () => {
    await tick();
    expect(platform.calls).toEqual([]);

    await as(operator, request(server()).post('/api/v1/ever-connect/connect'))
      .send({ code: 'EVC-TEST-0000-0001', displayName: 'Translations' })
      .expect(200);
    platform.calls.length = 0;
    await tick();
    expect(platform.names()).not.toContain('reportPersonLink');
  });

  it("reports Alice's Ever ID once an organization consented to ever_id_login, with ids only", async () => {
    platform.integrationStates.ever_id_login = { state: 'enabled', enabled: true, consentId: 'c-everid', scopeVersion: 2 };
    platform.events = [{ id: 'consent-1', type: 'ever.consent.integration.enabled', data: { integration: 'ever_id_login' } }];
    platform.calls.length = 0;
    await tick();
    expect(platform.personLinks[alice.id]).toMatchObject({
      productUserRef: alice.id,
      identityIssuer: ISSUER,
      identitySubject: 'alice-subject',
      linkMethod: 'explicit',
    });
    expect(Object.keys(platform.personLinks)).toEqual([alice.id]);
    expect(JSON.stringify(platform.calls)).not.toContain('@traduora.test');
  });

  it("answers Alice's export request with an export only she can download", async () => {
    platform.events = [
      {
        id: 'export-1',
        type: 'ever.registry.person.export_requested',
        data: { job_id: '01JEXPORTJOB0000000000000A', person_id: 'person-alice', subject_hashes: [subjectHash(ISSUER, 'alice-subject')] },
      },
    ];
    await tick();
    expect(platform.answers).toEqual([
      { jobId: '01JEXPORTJOB0000000000000A', result: 'exported', exportUrl: 'https://translate.example.test/user-settings' },
    ]);

    const list = await as(alice, request(server()).get('/api/v1/ever-connect/me/exports')).expect(200);
    expect(list.headers['cache-control']).toBe('no-store');
    expect(list.body.data.map(item => item.jobId)).toEqual(['01JEXPORTJOB0000000000000A']);
    const download = await as(alice, request(server()).get('/api/v1/ever-connect/me/exports/01JEXPORTJOB0000000000000A')).expect(200);
    expect(download.body.data).toMatchObject({
      format: 'ever-traduora.person-export.v1',
      account: { id: alice.id, email: alice.email },
      identities: [{ issuer: ISSUER, subject: 'alice-subject' }],
      projects: [{ name: 'My test project', role: 'admin' }],
    });

    // Nobody else: another user, an API client of her own project, the operator, or a signed-out caller
    for (const other of [bob, client, operator]) {
      await as(other, request(server()).get('/api/v1/ever-connect/me/exports/01JEXPORTJOB0000000000000A')).expect(404);
    }
    await as(bob, request(server()).get('/api/v1/ever-connect/me/exports'))
      .expect(200)
      .expect(res => expect(res.body.data).toEqual([]));
    await request(server()).get('/api/v1/ever-connect/me/exports/01JEXPORTJOB0000000000000A').expect(401);
    const stored = await app.get(Connection).getRepository(EverConnectPersonExport).find();
    expect(stored.map(row => row.userId)).toEqual([alice.id]);
    expect(stored[0].bundleEnc).not.toContain(alice.email);
  });

  it("answers Alice's deletion request while deletions are off: her Ever ID goes, her account stays, the request stays open", async () => {
    platform.events = [
      {
        id: 'deletion-1',
        type: 'ever.registry.person.deletion_requested',
        data: { job_id: '01JDELETIONJOB00000000000A', person_id: 'person-alice', subject_hashes: [subjectHash(ISSUER, 'alice-subject')] },
      },
    ];
    await tick();
    expect(platform.answers[1]).toEqual({ jobId: '01JDELETIONJOB00000000000A', result: 'failed', reasonCode: 'account_deletion_pending' });
    const connection = app.get(Connection);
    expect(await connection.getRepository(UserIdentity).count()).toBe(0);
    expect((await connection.getRepository(EverIdSession).findOne({ where: { sid: 'alice-session' } })).revokedAt).not.toBeNull();
    expect(await connection.getRepository(User).count({ where: { id: alice.id } })).toBe(1);
    // Her person link is removed at Ever Platform too
    expect(platform.names()).toContain('removePersonLink');
    expect(platform.personLinks).toEqual({});

    // Her password still signs her in
    await request(server())
      .post('/api/v1/auth/token')
      .send({ grant_type: 'password', username: alice.email, password: 'mysupersecretpassword' })
      .expect(200);
  });

  it('records each answer in the audit trail without an e-mail', async () => {
    const audit = await as(operator, request(server()).get('/api/v1/ever-connect/audit')).expect(200);
    const actions = audit.body.data.map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining(['person.export', 'person.deletion', 'person_link.sync']));
    expect(JSON.stringify(audit.body)).not.toContain('@traduora.test');
  });
});
