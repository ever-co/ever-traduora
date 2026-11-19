import { DataSource } from 'typeorm';
import { FakeEverPlatform } from '../../test/fake-ever-platform';
import { EverConnectAudit } from '../entity/ever-connect-audit.entity';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EverInstanceSettings } from '../ever-instance/ever-instance.settings';
import { auditHash, EverConnectAuditService } from './ever-connect-audit.service';
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

describe('EverConnectService', () => {
  let dataSource: DataSource;
  let platform: FakeEverPlatform;

  const build = (settings: Partial<EverConnectSettings> = {}, instanceSettings: Partial<EverInstanceSettings> = {}) => {
    const instance = new EverInstanceService(dataSource.getRepository(EverInstance), { ...INSTANCE_SETTINGS, ...instanceSettings });
    const audit = new EverConnectAuditService(dataSource.getRepository(EverConnectAudit));
    const connect = new EverConnectService(
      dataSource.getRepository(EverConnectConnection),
      dataSource.getRepository(EverConnectIntegration),
      { ...SETTINGS, ...settings },
      { ...INSTANCE_SETTINGS, ...instanceSettings },
      platform.factory,
      instance,
      audit,
    );
    const scheduler = new EverConnectSchedulerService(dataSource.getRepository(EverConnectConnection), { ...SETTINGS, ...settings }, connect, false);
    return { connect, scheduler, audit };
  };

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [EverInstance, EverConnectConnection, EverConnectIntegration, EverConnectAudit],
      synchronize: true,
    });
    await dataSource.initialize();
    platform = new FakeEverPlatform();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('calls nothing before an operator connects', async () => {
    const { connect, scheduler } = build();
    await scheduler.tick();
    await connect.heartbeat();
    expect(platform.calls).toEqual([]);
    expect((await connect.status()).connected).toBe(false);
  });

  it('connects with one redeem that carries no address and no user data, and stores the key encrypted', async () => {
    const { connect } = build();
    const status = await connect.connect(' evc-test-0000-0001 ', 'Our translations', 'user:u1');
    expect(status).toMatchObject({ connected: true, status: 'active', registryInstanceId: '01JMQCKINSTANCE0000000000A', linkState: 'active' });
    const redeem = platform.calls.filter(call => call.name === 'redeem');
    expect(redeem).toHaveLength(1);
    const body = redeem[0].args[0] as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['code', 'displayName', 'idempotencyKey', 'installSource', 'publicKey', 'version']);
    expect(body).toMatchObject({ code: 'EVC-TEST-0000-0001', version: '0.23.0', installSource: 'self-hosted', displayName: 'Our translations' });

    const row = await dataSource.getRepository(EverConnectConnection).findOne({ where: { id: 'self' } });
    expect(row.connectPrivateKeyEnc.startsWith('v1:')).toBe(true);
    expect(row.connectedBy).toBe('user:u1');
    // The documents were fetched (and verified by the client) right after the connect
    expect(platform.names()).toEqual(expect.arrayContaining(['entitlement', 'integrations']));
    expect(status.entitlement.state).toBe('valid');
  });

  it('refuses a malformed code without calling anything', async () => {
    const { connect } = build();
    await expect(connect.connect('not-a-code', '', 'user:u1')).rejects.toMatchObject({ code: 'code_invalid' });
    expect(platform.calls).toEqual([]);
  });

  it('refuses to connect without TR_SECRET, and a second time', async () => {
    await expect(build({}, { secret: '' }).connect.connect('EVC-TEST-0000-0001', '', 'user:u1')).rejects.toMatchObject({ code: 'secret_missing' });
    expect(platform.calls).toEqual([]);
    const { connect } = build();
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    const before = platform.calls.length;
    await expect(connect.connect('EVC-TEST-0000-0001', '', 'user:u1')).rejects.toMatchObject({ code: 'already_connected' });
    expect(platform.calls).toHaveLength(before);
  });

  it('passes a refused code on and stores nothing', async () => {
    const { connect } = build();
    await expect(connect.connect('EVC-TEST-0000-0009', '', 'user:u1')).rejects.toMatchObject({ code: 'code_invalid' });
    // The claim made for the attempt is released: nothing connected, no key kept
    const row = await connect.read();
    expect(row).toMatchObject({ status: 'not_connected', registryInstanceId: null, connectPrivateKeyEnc: null });
    expect((await connect.status()).connected).toBe(false);
  });

  it('sends the heartbeat, reads the feed and follows consent events', async () => {
    const { connect, scheduler } = build({ integrationsDeny: ['ever_id_login'] });
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    platform.calls.length = 0;
    await dataSource.getRepository(EverConnectConnection).update({ id: 'self' }, { nextHeartbeatAt: 0, nextEntitlementAt: Date.now() + 3600000 });

    platform.integrationStates.instance_url = { state: 'enabled', enabled: true, consentId: 'c1', scopeVersion: 1 };
    platform.events = [{ id: 'e1', type: 'ever.consent.integration.enabled' }];
    await scheduler.tick();

    const heartbeat = platform.calls.find(call => call.name === 'heartbeat');
    expect(heartbeat.args[0]).toEqual({ version: '0.23.0', moduleVersion: '1.0.0', integrationsDenied: ['ever_id_login'] });
    expect(platform.names()).toEqual(expect.arrayContaining(['events', 'integrations', 'ack']));
    const views = await connect.integrations();
    expect(views.find(view => view.key === 'instance_url').state).toBe('enabled');
    expect(views.find(view => view.key === 'ever_id_login').state).toBe('denied_by_policy');
    const connection = await connect.read();
    expect(connection.feedCursor).toBe('e1');
  });

  it('sets the public address only after the instance_url consent', async () => {
    const { connect } = build();
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    await expect(connect.setPublicUrl('https://translate.example.com', 'user:u1')).rejects.toMatchObject({ code: 'consent_required' });
    expect(platform.names()).not.toContain('putPublicUrl');
    await expect(connect.setPublicUrl('http://translate.example.com', 'user:u1')).rejects.toMatchObject({ code: 'url_invalid' });

    platform.integrationStates.instance_url = { state: 'enabled', enabled: true, consentId: 'c1', scopeVersion: 1 };
    await connect.refreshIntegrations();
    await connect.setPublicUrl('https://translate.example.com', 'user:u1');
    expect(platform.calls.find(call => call.name === 'putPublicUrl').args[0]).toBe('https://translate.example.com/');
  });

  it('switches an integration off here when Ever Platform cannot be told, and tells it at the next heartbeat', async () => {
    const { connect } = build();
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    platform.integrationStates.instance_url = { state: 'enabled', enabled: true, consentId: 'c1', scopeVersion: 1 };
    await connect.refreshIntegrations();

    platform.unreachable = true;
    const views = await connect.disableIntegration('instance_url', 'user:u1');
    expect(views.find(view => view.key === 'instance_url')).toMatchObject({ state: 'disabled', pendingRemoteRevoke: true });

    platform.unreachable = false;
    platform.calls.length = 0;
    await connect.heartbeat();
    expect(platform.names()).toEqual(['heartbeat', 'disableIntegration']);
    expect((await connect.integrations()).find(view => view.key === 'instance_url').pendingRemoteRevoke).toBe(false);
  });

  it('accepts an installation-wide integration only when it waits for the operator', async () => {
    const { connect } = build();
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    await expect(connect.acceptIntegration('stats_link', true, 'user:u1')).rejects.toMatchObject({ code: 'nothing_to_accept' });
    platform.integrationStates.stats_link = { state: 'pending_operator', enabled: false, consentId: 'c2', scopeVersion: 1 };
    await connect.refreshIntegrations();
    const views = await connect.acceptIntegration('stats_link', true, 'user:u1');
    expect(platform.calls.find(call => call.name === 'acceptIntegration').args).toEqual(['stats_link', 'c2', true]);
    expect(views.find(view => view.key === 'stats_link').state).toBe('enabled');
  });

  it('waits for approval, reading only its own state, then starts', async () => {
    const { connect, scheduler } = build();
    platform.redeemStatus = 'pending_approval';
    platform.instanceStatus = 'pending_approval';
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    platform.calls.length = 0;
    await scheduler.tick();
    expect(platform.names()).toEqual(['self']);
    expect((await connect.status()).status).toBe('pending_approval');

    platform.instanceStatus = 'active';
    platform.calls.length = 0;
    await scheduler.tick();
    expect((await connect.status()).status).toBe('active');
    expect(platform.names()).toEqual(expect.arrayContaining(['self', 'entitlement', 'integrations']));
  });

  it('keeps an integration off here while its revoke waits, and never sends to a denied one', async () => {
    const { connect } = build();
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    platform.integrationStates.instance_url = { state: 'enabled', enabled: true, consentId: 'c1', scopeVersion: 1 };
    await connect.refreshIntegrations();
    platform.unreachable = true;
    await connect.disableIntegration('instance_url', 'user:u1');
    platform.unreachable = false;
    // Ever Platform was not told yet, so it still reports the integration on
    platform.integrationStates.instance_url = { state: 'enabled', enabled: true, consentId: 'c1', scopeVersion: 1 };
    const views = await connect.refreshIntegrations();
    expect(views.find(view => view.key === 'instance_url')).toMatchObject({ state: 'disabled', pendingRemoteRevoke: true });

    const denied = build({ integrationsDeny: ['instance_url'] }).connect;
    await expect(denied.setPublicUrl('https://translate.example.com', 'user:u1')).rejects.toMatchObject({ code: 'denied_by_policy' });
    expect(platform.names()).not.toContain('putPublicUrl');
  });

  it('stops calling once Ever Platform revoked the installation', async () => {
    const { connect, scheduler } = build();
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    platform.revoked = true;
    await connect.heartbeat();
    expect((await connect.status()).status).toBe('revoked');
    platform.calls.length = 0;
    await scheduler.tick();
    expect(platform.calls).toEqual([]);
  });

  it('disconnects: tells Ever Platform, forgets the key and the documents, and calls nothing more', async () => {
    const { connect, scheduler } = build();
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    const status = await connect.disconnect('user:u1');
    expect(platform.names()).toContain('disconnect');
    expect(status).toMatchObject({ connected: false, status: 'disconnected' });
    const row = await connect.read();
    expect(row.connectPrivateKeyEnc).toBeNull();
    expect(row.entitlements).toBeNull();
    platform.calls.length = 0;
    await scheduler.tick();
    expect(platform.calls).toEqual([]);
  });

  it('redeems TR_EVER_CONNECT_CODE once, even when it is refused', async () => {
    const { connect } = build({ connectCode: 'EVC-TEST-0000-0009' });
    await connect.connectFromEnv();
    await connect.connectFromEnv();
    expect(platform.names().filter(name => name === 'redeem')).toHaveLength(1);
  });

  it('keeps a chained audit trail with user ids, never an e-mail', async () => {
    const { connect, audit } = build();
    await connect.connect('EVC-TEST-0000-0001', '', 'user:u1');
    await connect.disconnect('user:u1');
    const rows = (await audit.rows()).reverse();
    expect(rows.map(row => row.action)).toEqual(['instance.connect', 'link.create', 'instance.disconnect']);
    rows.forEach((row, i) => {
      expect(row.prevHash).toBe(i === 0 ? null : rows[i - 1].hash);
      expect(row.hash).toBe(auditHash(row));
      expect(`${row.actorRef} ${row.detail}`).not.toMatch(/@/);
    });
  });
});
