// The optional modules are chosen when app.module.ts is first loaded: switch the connection on before anything imports it
process.env.TR_EVER_CONNECT_ENABLED = 'true';
// The statistics (on by default) stay off here: this suite talks to a local fake platform only
process.env.TR_EVER_STATS_ENABLED = 'false';

import { INestApplication } from '@nestjs/common';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { config } from '../src/config';
import { EverConnectManagedOperation } from '../src/entity/ever-connect-managed-operation.entity';
import { supportedKinds } from '../src/ever-connect/ever-connect-managed.service';
import { EVER_CONNECT_CLIENT_FACTORY } from '../src/ever-connect/ever-connect-platform.client';
import { EVER_CONNECT_AUTOSTART, EverConnectSchedulerService } from '../src/ever-connect/ever-connect-scheduler.service';
import { EVER_CONNECT_SETTINGS, readEverConnectSettings } from '../src/ever-connect/ever-connect.settings';
import { EVER_INSTANCE_SETTINGS } from '../src/ever-instance/ever-instance.settings';
import { FakeEverPlatform } from './fake-ever-platform';
import './util';
import { createAndMigrateAppWith, signupTestUser, TestingUser } from './util';

const OPERATOR_EMAIL = 'operator@traduora.test';
// The whole week, every minute (an end time is exclusive, so the day is two windows: 00:00-12:00 and 12:00-00:00)
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_WEEK = [
  { days: EVERY_DAY, from: '00:00', to: '12:00' },
  { days: EVERY_DAY, from: '12:00', to: '00:00' },
];
const SQLITE = config.db.default.type === 'better-sqlite3';

const operation = (id: string, kind: string) => ({
  operation_id: id,
  org_id: '01JNB79NZW2S85GF4A96MMX6BT',
  instance_id: '01JNE7V9J03J6XQ2WN8H0Z88R5',
  kind,
  params: {},
  not_before: new Date(Date.now() - 60000).toISOString(),
  expires_at: new Date(Date.now() + 86400000).toISOString(),
});

describe('Maintenance operations through the Ever Platform connection (e2e)', () => {
  let app: INestApplication;
  let operator: TestingUser;
  let translator: TestingUser;
  let backupDir: string;
  const platform = new FakeEverPlatform();

  const server = () => app.getHttpServer();
  const as = (user: TestingUser, call: request.Test) => call.set('Authorization', `Bearer ${user.accessToken}`);
  const tick = () => app.get(EverConnectSchedulerService).tick();
  const history = () => app.get(Connection).getRepository(EverConnectManagedOperation).find();

  beforeAll(async () => {
    backupDir = await fs.mkdtemp(join(tmpdir(), 'tr-managed-e2e-'));
    app = await createAndMigrateAppWith([
      { provide: EVER_CONNECT_AUTOSTART, useValue: false },
      { provide: EVER_CONNECT_CLIENT_FACTORY, useValue: platform.factory },
      { provide: EVER_CONNECT_SETTINGS, useValue: { ...readEverConnectSettings(), apiUrl: 'http://127.0.0.1:8080', feedMode: 'longpoll' } },
      { provide: EVER_INSTANCE_SETTINGS, useValue: { installSource: 'self-hosted', adminEmails: [OPERATOR_EMAIL], secret: 'e2e-managed-secret' } },
    ]);
    operator = await signupTestUser(app, OPERATOR_EMAIL);
    translator = await signupTestUser(app, 'translator@traduora.test');
    await as(operator, request(server()).post('/api/v1/ever-connect/connect')).send({ code: 'EVC-TEST-0000-0001' }).expect(200);
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
    await fs.rm(backupDir, { recursive: true, force: true });
  });

  it('keeps the opt-in to the operator, off by default', async () => {
    await as(translator, request(server()).get('/api/v1/ever-connect/managed')).expect(404);
    await as(translator, request(server()).put('/api/v1/ever-connect/managed')).send({ optIn: true }).expect(404);
    const view = await as(operator, request(server()).get('/api/v1/ever-connect/managed')).expect(200);
    expect(view.body.data).toMatchObject({ available: true, optIn: false, kinds: [], supportedKinds: supportedKinds(config.db.default.type) });
  });

  it('refuses a request while the operator has not opted in, and runs nothing', async () => {
    platform.integrationStates.managed_operations = { state: 'enabled', enabled: true, consentId: 'c-managed', scopeVersion: 1 };
    platform.events = [
      { id: 'consent-1', type: 'ever.consent.integration.enabled', data: { integration: 'managed_operations' } },
      { id: 'op-1', type: 'ever.registry.managed_operation.requested', data: operation('01JQV4Q5BHCZ330557Y206H9AA', 'health_report') },
    ];
    await tick();
    expect(platform.managedResults['01JQV4Q5BHCZ330557Y206H9AA']).toEqual({ status: 'failed' });
    expect((await history())[0]).toMatchObject({ status: 'refused', reason: 'no_operator_opt_in' });
  });

  it('runs the operations the operator allowed, and tells Ever Platform the status and size only', async () => {
    const saved = await as(operator, request(server()).put('/api/v1/ever-connect/managed'))
      .send({ optIn: true, kinds: supportedKinds(config.db.default.type), windows: ALL_WEEK, backupDir })
      .expect(200);
    expect(JSON.stringify(saved.body)).not.toContain(backupDir);
    expect(saved.body.data).toMatchObject({ optIn: true, backupDirSet: true });

    platform.events = [
      { id: 'op-2', type: 'ever.registry.managed_operation.requested', data: operation('01JQV4Q5BHCZ330557Y206H9AB', 'health_report') },
      { id: 'op-3', type: 'ever.registry.managed_operation.requested', data: operation('01JQV4Q5BHCZ330557Y206H9AC', 'backup') },
    ];
    await tick();
    expect(platform.managedResults['01JQV4Q5BHCZ330557Y206H9AB']).toMatchObject({ status: 'succeeded' });
    const backup = platform.managedResults['01JQV4Q5BHCZ330557Y206H9AC'] as Record<string, unknown>;
    if (SQLITE) {
      expect(backup).toMatchObject({ status: 'succeeded' });
      expect(Object.keys(backup).sort((a, b) => a.localeCompare(b))).toEqual(['artefact_ref', 'size_bytes', 'status']);
      expect((await fs.readdir(backupDir)).length).toBe(2);
    } else {
      // PostgreSQL and MySQL backups need their own dump tools, which the image does not ship
      expect(backup).toEqual({ status: 'failed' });
      expect((await history()).find(row => row.operationId === '01JQV4Q5BHCZ330557Y206H9AC').reason).toBe('unsupported_dialect');
    }
    expect(JSON.stringify(platform.calls)).not.toContain(backupDir);

    const view = await as(operator, request(server()).get('/api/v1/ever-connect/managed')).expect(200);
    expect(view.body.data.history.map(row => row.operationId)).toEqual(
      expect.arrayContaining(['01JQV4Q5BHCZ330557Y206H9AA', '01JQV4Q5BHCZ330557Y206H9AB', '01JQV4Q5BHCZ330557Y206H9AC']),
    );
  });

  it('records the opt-in and each result in the audit trail', async () => {
    const audit = await as(operator, request(server()).get('/api/v1/ever-connect/audit')).expect(200);
    const actions = audit.body.data.map(row => row.action);
    expect(actions).toEqual(expect.arrayContaining(['managed.opt_in', 'managed.refused', 'managed.result']));
    expect(JSON.stringify(audit.body)).not.toContain(backupDir);
  });
});
