import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { FakeEverPlatform } from '../../test/fake-ever-platform';
import { config } from '../config';
import { EverConnectAudit } from '../entity/ever-connect-audit.entity';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverConnectManagedOperation } from '../entity/ever-connect-managed-operation.entity';
import { EverConnectManagedPolicy } from '../entity/ever-connect-managed-policy.entity';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EverInstanceSettings } from '../ever-instance/ever-instance.settings';
import { SnakeNamingStrategy } from '../utils/snake-naming-strategy';
import { EverConnectAuditService } from './ever-connect-audit.service';
import { EverConnectManagedService, inWindow } from './ever-connect-managed.service';
import { EverConnectSchedulerService } from './ever-connect-scheduler.service';
import { EverConnectService } from './ever-connect.service';
import { EverConnectSettings } from './ever-connect.settings';

const SETTINGS: EverConnectSettings = {
  apiUrl: 'http://127.0.0.1:8080',
  installSource: 'self-hosted',
  version: '0.23.0',
  connectCode: null,
  integrationsDeny: [],
  feedMode: 'interval',
  issuer: null,
  rootKeysFile: null,
  statsLoaded: false,
};

const INSTANCE_SETTINGS: EverInstanceSettings = { installSource: 'self-hosted', adminEmails: [], secret: 'unit-test-secret-of-this-installation' };
const TYPE = 'ever.registry.managed_operation.requested';
// The whole week, every minute (an end time is exclusive, so the day is two windows: 00:00-12:00 and 12:00-00:00)
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];
const ALL_WEEK = [
  { days: EVERY_DAY, from: '00:00', to: '12:00' },
  { days: EVERY_DAY, from: '12:00', to: '00:00' },
];

// Runs the real migrations on an in-memory SQLite database (backups are SQLite-only): only when TR_DB_TYPE is SQLite
const describeOnSqlite = config.db.default.type === 'better-sqlite3' ? describe : describe.skip;

describeOnSqlite('EverConnectManagedService', () => {
  let dataSource: DataSource;
  let platform: FakeEverPlatform;
  let backupDir: string;
  let ids = 0;

  /** A distinct operation id (a ULID, as Ever Platform sends). */
  const nextId = () => `01JQV4Q5BHCZ330557Y206H9${'ABCDEFGHJKMNPQRSTVWXYZ'[Math.floor(ids / 22) % 22]}${'ABCDEFGHJKMNPQRSTVWXYZ'[ids++ % 22]}`;

  const request = (kind: string, options: { params?: Record<string, unknown>; notBefore?: number; id?: string } = {}) => ({
    operation_id: options.id || nextId(),
    org_id: '01JNB79NZW2S85GF4A96MMX6BT',
    instance_id: '01JNE7V9J03J6XQ2WN8H0Z88R5',
    kind,
    params: options.params || {},
    not_before: new Date(options.notBefore || Date.now() - 60000).toISOString(),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });

  const build = (settings: Partial<EverConnectSettings> = {}) => {
    const all = { ...SETTINGS, ...settings };
    const instance = new EverInstanceService(dataSource.getRepository(EverInstance), INSTANCE_SETTINGS);
    const audit = new EverConnectAuditService(dataSource.getRepository(EverConnectAudit));
    const connect = new EverConnectService(
      dataSource.getRepository(EverConnectConnection),
      dataSource.getRepository(EverConnectIntegration),
      all,
      INSTANCE_SETTINGS,
      platform.factory,
      instance,
      audit,
    );
    const managed = new EverConnectManagedService(
      dataSource.getRepository(EverConnectManagedPolicy),
      dataSource.getRepository(EverConnectManagedOperation),
      dataSource.getRepository(EverConnectIntegration),
      all,
      INSTANCE_SETTINGS,
      audit,
    );
    const scheduler = new EverConnectSchedulerService(dataSource.getRepository(EverConnectConnection), all, connect, false, undefined, managed);
    return { connect, managed, scheduler };
  };

  const connected = async (settings: Partial<EverConnectSettings> = {}) => {
    const built = build(settings);
    await built.connect.connect('EVC-TEST-0000-0001', 'Translations', 'user:u1');
    platform.calls.length = 0;
    const live = await built.connect.liveClient();
    return { ...built, client: live.client };
  };

  const consent = async (connect: EverConnectService) => {
    platform.integrationStates.managed_operations = { state: 'enabled', enabled: true, consentId: 'c-managed', scopeVersion: 1 };
    await connect.refreshIntegrations();
    platform.calls.length = 0;
  };

  const history = () => dataSource.getRepository(EverConnectManagedOperation).find();

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [join(__dirname, '../entity/*.entity.ts')],
      migrations: [join(__dirname, '../migrations/*.ts')],
      namingStrategy: new SnakeNamingStrategy(),
      logging: false,
    } as DataSourceOptions);
    await dataSource.initialize();
    await dataSource.runMigrations();
    platform = new FakeEverPlatform();
    backupDir = await fs.mkdtemp(join(tmpdir(), 'tr-managed-'));
  });

  afterEach(async () => {
    await dataSource.destroy();
    await fs.rm(backupDir, { recursive: true, force: true });
  });

  it('knows the windows, overnight ones included (UTC)', () => {
    const monday = (hhmm: string) => Date.parse(`2026-11-16T${hhmm}:00Z`);
    expect(inWindow([{ days: [1], from: '02:00', to: '04:00' }], monday('03:00'))).toBe(true);
    expect(inWindow([{ days: [1], from: '02:00', to: '04:00' }], monday('04:00'))).toBe(false);
    // Sunday 23:00 to Monday 01:00
    expect(inWindow([{ days: [0], from: '23:00', to: '01:00' }], monday('00:30'))).toBe(true);
    expect(inWindow([{ days: [1], from: '23:00', to: '01:00' }], monday('00:30'))).toBe(false);
  });

  it('refuses every operation without the consent, and writes nothing', async () => {
    const { managed, client } = await connected();
    await managed.update({ optIn: true, kinds: ['backup'], windows: ALL_WEEK, backupDir }, 'user:u1');
    const op = request('backup');
    await managed.handle(client, op, 'kid-1');
    expect(platform.managedResults[op.operation_id]).toEqual({ status: 'failed' });
    expect((await history())[0]).toMatchObject({ status: 'refused', reason: 'no_consent' });
    expect(await fs.readdir(backupDir)).toEqual([]);
  });

  it("refuses without the operator's opt-in, outside the windows, and for a kind not allowed", async () => {
    const { connect, managed, client } = await connected();
    await consent(connect);
    const first = request('health_report');
    await managed.handle(client, first, 'kid-1');
    expect((await history()).find(row => row.operationId === first.operation_id)).toMatchObject({ status: 'refused', reason: 'no_operator_opt_in' });

    const now = new Date();
    const otherDay = (now.getUTCDay() + 3) % 7;
    await managed.update({ optIn: true, kinds: ['health_report'], windows: [{ days: [otherDay], from: '00:00', to: '01:00' }] }, 'user:u1');
    const second = request('health_report');
    await managed.handle(client, second, 'kid-1');
    expect((await history()).find(row => row.operationId === second.operation_id).reason).toBe('outside_window');

    await managed.update({ windows: ALL_WEEK, backupDir }, 'user:u1');
    const third = request('backup');
    await managed.handle(client, third, 'kid-1');
    expect((await history()).find(row => row.operationId === third.operation_id).reason).toBe('kind_not_allowed');
    const update = request('update', { params: { target_version: '1.5.0' } });
    await managed.handle(client, update, 'kid-1');
    expect((await history()).find(row => row.operationId === update.operation_id).reason).toBe('update_not_supported');
    expect(Object.values(platform.managedResults).every(result => JSON.stringify(result) === '{"status":"failed"}')).toBe(true);
    expect(await fs.readdir(backupDir)).toEqual([]);
  });

  it('backs the database up into the directory, checks it, and tells Ever Platform the status and size only', async () => {
    const { connect, managed, client } = await connected();
    await consent(connect);
    await managed.update({ optIn: true, kinds: ['health_report', 'backup', 'restore_check'], windows: ALL_WEEK, backupDir }, 'user:u1');

    const health = request('health_report');
    await managed.handle(client, health, 'kid-1');
    expect(platform.managedResults[health.operation_id]).toEqual({ status: 'succeeded', version: '0.23.0' });

    const backup = request('backup');
    await managed.handle(client, backup, 'kid-1');
    const result = platform.managedResults[backup.operation_id] as { status: string; artefact_ref: string; size_bytes: number };
    expect(result.status).toBe('succeeded');
    expect(result.size_bytes).toBeGreaterThan(0);
    expect(Object.keys(result).sort()).toEqual(['artefact_ref', 'size_bytes', 'status']);
    expect(JSON.stringify(platform.calls)).not.toContain(backupDir);
    const files = (await fs.readdir(backupDir)).sort();
    expect(files).toEqual([`${result.artefact_ref}.manifest.json`, `${result.artefact_ref}.sqlite3`]);

    const check = request('restore_check', { params: { artefact_ref: result.artefact_ref } });
    await managed.handle(client, check, 'kid-1');
    expect(platform.managedResults[check.operation_id]).toMatchObject({ status: 'succeeded', size_bytes: result.size_bytes });

    // A damaged backup fails its check
    await fs.appendFile(join(backupDir, `${result.artefact_ref}.sqlite3`), 'x');
    const again = request('restore_check', { params: { artefact_ref: result.artefact_ref } });
    await managed.handle(client, again, 'kid-1');
    expect(platform.managedResults[again.operation_id]).toMatchObject({ status: 'failed' });

    // The history holds status and size; a repeated delivery changes nothing
    const calls = platform.calls.length;
    await managed.handle(client, backup, 'kid-1');
    expect(platform.calls).toHaveLength(calls);
    expect((await history()).find(row => row.operationId === backup.operation_id)).toMatchObject({
      status: 'succeeded',
      sizeBytes: result.size_bytes,
    });
  });

  it('runs a request at its start time, not before', async () => {
    const { connect, managed, client } = await connected();
    await consent(connect);
    await managed.update({ optIn: true, kinds: ['health_report'], windows: ALL_WEEK }, 'user:u1');
    const later = Date.now() + 3600000;
    const op = request('health_report', { notBefore: later });
    await managed.handle(client, op, 'kid-1');
    expect(platform.managedResults[op.operation_id]).toBeUndefined();
    expect((await history())[0]).toMatchObject({ status: 'deferred' });

    expect(await managed.runDue(client, 'kid-1', Date.now())).toBe(0);
    expect(await managed.runDue(client, 'kid-1', later + 1000)).toBe(1);
    expect(platform.managedResults[op.operation_id]).toMatchObject({ status: 'succeeded' });
  });

  it('lets a request with a later start time wait, and checks consent, opt-in and window only when it starts', async () => {
    const { connect, managed, client } = await connected();
    const later = Date.now() + 3600000;
    const op = request('health_report', { notBefore: later });
    // Neither consent nor opt-in yet: nothing is refused, the request waits
    await managed.handle(client, op, 'kid-1');
    expect(platform.managedResults[op.operation_id]).toBeUndefined();
    expect((await history())[0]).toMatchObject({ status: 'deferred' });
    await consent(connect);
    await managed.update({ optIn: true, kinds: ['health_report'], windows: ALL_WEEK }, 'user:u1');
    expect(await managed.runDue(client, 'kid-1', later + 1000)).toBe(1);
    expect(platform.managedResults[op.operation_id]).toMatchObject({ status: 'succeeded' });
    // Claimed and done: read again, it runs no second time
    const calls = platform.calls.length;
    await managed.handle(client, op, 'kid-1', later + 2000);
    expect(platform.calls).toHaveLength(calls);
  });

  it('cancels the work of an ended connection instead of running it through the next one', async () => {
    const { connect, managed, client } = await connected();
    await consent(connect);
    await managed.update({ optIn: true, kinds: ['health_report'], windows: ALL_WEEK }, 'user:u1');
    const later = Date.now() + 3600000;
    const op = request('health_report', { notBefore: later });
    await managed.handle(client, op, 'kid-old');
    expect(await managed.runDue(client, 'kid-1', later + 1000)).toBe(0);
    expect(platform.managedResults[op.operation_id]).toBeUndefined();
    expect((await history())[0]).toMatchObject({ status: 'failed', reason: 'connection_ended', request: null });
  });

  it('keeps a result Ever Platform could not receive, and sends it again', async () => {
    const { connect, managed, client } = await connected();
    await consent(connect);
    await managed.update({ optIn: true, kinds: ['health_report'], windows: ALL_WEEK }, 'user:u1');
    const op = request('health_report');
    platform.unreachable = true;
    await expect(managed.handle(client, op, 'kid-1')).rejects.toThrow();
    platform.unreachable = false;
    expect((await history())[0].unsentResult).not.toBeNull();
    await managed.runDue(client, 'kid-1');
    expect(platform.managedResults[op.operation_id]).toMatchObject({ status: 'succeeded' });
    expect((await history())[0].unsentResult).toBeNull();
  });

  it('checks the lease before each saved result it sends again, and stops once another process holds it', async () => {
    const { connect, managed, client } = await connected();
    await consent(connect);
    await managed.update({ optIn: true, kinds: ['health_report'], windows: ALL_WEEK }, 'user:u1');
    const saved = [request('health_report'), request('health_report')];
    platform.unreachable = true;
    for (const op of saved) {
      await expect(managed.handle(client, op, 'kid-1')).rejects.toThrow();
    }
    platform.unreachable = false;
    const later = Date.now() + 3600000;
    const deferred = request('health_report', { notBefore: later });
    await managed.handle(client, deferred, 'kid-1');
    const unsent = async () => (await history()).filter(row => row.unsentResult !== null).length;
    expect(await unsent()).toBe(2);

    // The lease holds for the first send only
    let checks = 0;
    expect(await managed.runDue(client, 'kid-1', later + 1000, async () => ++checks === 1)).toBe(0);
    expect(checks).toBe(2);
    expect(saved.filter(op => platform.managedResults[op.operation_id])).toHaveLength(1);
    expect(await unsent()).toBe(1);
    expect(platform.managedResults[deferred.operation_id]).toBeUndefined();

    // The next round that holds the lease sends the rest, then runs the due work
    expect(await managed.runDue(client, 'kid-1', later + 1000)).toBe(1);
    expect(await unsent()).toBe(0);
    expect(platform.managedResults[deferred.operation_id]).toMatchObject({ status: 'succeeded' });
  });

  it("keeps the operator's settings checked, and the backup directory write-only", async () => {
    const { managed } = await connected();
    await expect(managed.update({ kinds: ['update'] }, 'user:u1')).rejects.toMatchObject({ code: 'invalid_managed' });
    await expect(managed.update({ backupDir: 'relative/dir' }, 'user:u1')).rejects.toMatchObject({ code: 'invalid_managed' });
    await expect(managed.update({ windows: [{ days: [7], from: '00:00', to: '01:00' }] }, 'user:u1')).rejects.toMatchObject({
      code: 'invalid_managed',
    });
    const view = await managed.update({ optIn: true, kinds: ['backup'], windows: ALL_WEEK, backupDir }, 'user:u1');
    expect(view).toMatchObject({ available: true, optIn: true, kinds: ['backup'], backupDirSet: true });
    expect(JSON.stringify(view)).not.toContain(backupDir);
    const stored = await dataSource.getRepository(EverConnectManagedPolicy).findOne({ where: { id: 'self' } });
    expect(stored.backupDirEnc).not.toContain(backupDir);
    const audit = await dataSource.getRepository(EverConnectAudit).find();
    expect(audit.map(row => row.action)).toContain('managed.opt_in');

    await expect(build({ installSource: 'cloud' }).managed.view()).rejects.toMatchObject({ status: 404 });
  });

  it('holds due work while a feed page failed, and runs it once a full state re-read (410) succeeds', async () => {
    const { connect, managed, scheduler } = await connected({ feedMode: 'longpoll' });
    await consent(connect);
    await managed.update({ optIn: true, kinds: ['health_report'], windows: ALL_WEEK }, 'user:u1');
    const op = request('health_report', { notBefore: Date.now() - 1000 });
    // Due now, waiting in the history
    await dataSource.getRepository(EverConnectManagedOperation).insert({
      operationId: op.operation_id,
      kind: 'health_report',
      status: 'deferred',
      reason: null,
      sizeBytes: null,
      request: JSON.stringify(op),
      unsentResult: null,
      connectionKid: 'kid-1',
      notBefore: Date.now() - 1000,
      at: Date.now(),
    });
    await dataSource
      .getRepository(EverConnectConnection)
      .update({ id: 'self' }, { nextHeartbeatAt: Date.now() + 3600000, nextEntitlementAt: Date.now() + 3600000 });

    // A page whose state refresh fails: due work waits
    platform.events = [{ id: 'e1', type: 'ever.consent.integration.enabled', data: { integration: 'managed_operations' } }];
    platform.integrationsFailing = true;
    await scheduler.tick();
    expect(platform.managedResults[op.operation_id]).toBeUndefined();

    // A failed re-read keeps it waiting
    platform.eventsGone = 'evt-9';
    await expect(scheduler.tick()).rejects.toBeDefined();
    expect(platform.managedResults[op.operation_id]).toBeUndefined();

    // A successful re-read releases it in the same round
    platform.integrationsFailing = false;
    await scheduler.tick();
    expect(platform.managedResults[op.operation_id]).toMatchObject({ status: 'succeeded' });
    expect((await connect.read()).feedCursor).toBe('evt-9');
  });

  it('runs a request whose consent arrives in the same feed page', async () => {
    const { managed, scheduler } = await connected();
    await managed.update({ optIn: true, kinds: ['health_report'], windows: ALL_WEEK }, 'user:u1');
    platform.integrationStates.managed_operations = { state: 'enabled', enabled: true, consentId: 'c-managed', scopeVersion: 1 };
    const op = request('health_report');
    platform.events = [
      { id: 'e1', type: 'ever.consent.integration.enabled', data: { integration: 'managed_operations' } },
      { id: 'e2', type: TYPE, data: op },
    ];
    await scheduler.readFeed(0);
    expect(platform.managedResults[op.operation_id]).toMatchObject({ status: 'succeeded' });
    expect(platform.names()).toContain('ack');
  });

  it('keeps the lease renewed while one long step of a round runs, and releases it after the round', async () => {
    const { connect, managed, scheduler } = await connected();
    await consent(connect);
    const connections = dataSource.getRepository(EverConnectConnection);
    await connections.update({ id: 'self' }, { nextHeartbeatAt: Date.now() + 3600000, nextEntitlementAt: Date.now() + 3600000 });
    scheduler.keepAliveMs = 20;
    const seen: number[] = [];
    // One step much longer than the renewal interval (as a backup that outlives the lease would be)
    const runDue = jest.spyOn(managed, 'runDue').mockImplementation(async () => {
      for (let i = 0; i < 4; i++) {
        await new Promise(resolve => setTimeout(resolve, 40));
        const row = await connections.findOne({ where: { id: 'self' } });
        expect(row.leasedBy).toBe(scheduler.holderId);
        seen.push(row.leaseUntil);
      }
      return 0;
    });
    await scheduler.tick();
    expect(runDue).toHaveBeenCalledTimes(1);
    expect(seen).toHaveLength(4);
    // Renewed while the step ran: each reading is later than the one before
    expect(seen.every((until, i) => i === 0 || until > seen[i - 1])).toBe(true);
    // Released after the round, and no renewal still in flight takes it again
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(await connections.findOne({ where: { id: 'self' } })).toMatchObject({ leasedBy: null, leaseUntil: null });
  });
});
