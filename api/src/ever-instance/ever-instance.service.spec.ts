import { ExecutionContext } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { User } from '../entity/user.entity';
import { EverAdminGuard } from './ever-admin.guard';
import { EverInstanceService } from './ever-instance.service';
import { EverInstanceSettings } from './ever-instance.settings';
import { EverInstanceKeyError, keyIdOf, publicKeyOfPrivate, signBytes, unwrapStatsKey, verifyBytes, wrapStatsKey } from './key-wrap';

const SECRET = 'unit-test-secret-of-this-installation';

const settings = (overrides: Partial<EverInstanceSettings> = {}): EverInstanceSettings => ({
  installSource: 'self-hosted',
  adminEmails: ['operator@example.com'],
  secret: SECRET,
  ...overrides,
});

const user = (email: string): User => {
  const u = new User();
  u.id = '00000000-0000-4000-8000-000000000001';
  u.email = email;
  return u;
};

describe('EverInstanceService', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [EverInstance], synchronize: true });
    await dataSource.initialize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  const service = (overrides: Partial<EverInstanceSettings> = {}) =>
    new EverInstanceService(dataSource.getRepository(EverInstance), settings(overrides));

  it('creates one identity, even when asked twice at once', async () => {
    const instance = service();
    const [a, b] = await Promise.all([instance.ensure(), instance.ensure()]);
    expect(a.instanceId).toBe(b.instanceId);
    expect(await dataSource.getRepository(EverInstance).count()).toBe(1);
    expect(a.instanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a.statsPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.statsKeyId).toBe(keyIdOf(a.statsPublicKey));
    expect(a.statsEnabledUi).toBe(true);
    expect(a.resetCount).toBe(0);
  });

  it('never stores the private key in clear', async () => {
    const instance = service();
    const record = await instance.ensure();
    const { privateKeyDer } = await instance.signingIdentity();
    expect(record.statsPrivateKeyEnc.startsWith('v1:')).toBe(true);
    expect(record.statsPrivateKeyEnc).not.toContain(privateKeyDer.toString('base64'));
    expect(record.statsPrivateKeyEnc).not.toContain(privateKeyDer.toString('base64url'));
    expect(publicKeyOfPrivate(privateKeyDer)).toBe(record.statsPublicKey);
  });

  it('creates a new identity when TR_SECRET changed and the stored key cannot be read', async () => {
    const before = await service().ensure();
    const after = await service({ secret: 'another-secret-of-this-installation' }).ensure();
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(after.statsPublicKey).not.toBe(before.statsPublicKey);
    expect(after.resetCount).toBe(1);
  });

  it('creates nothing without a configured TR_SECRET', async () => {
    await expect(service({ secret: '' }).ensure()).rejects.toBeInstanceOf(EverInstanceKeyError);
    expect(await dataSource.getRepository(EverInstance).count()).toBe(0);
  });

  it('resets the identity on request and keeps the switch', async () => {
    const instance = service();
    const before = await instance.ensure();
    await instance.setStatsEnabledUi('user-1', false);
    const after = await instance.resetIdentity('user-1');
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(after.statsKeyId).not.toBe(before.statsKeyId);
    expect(after.resetCount).toBe(1);
    expect(after.statsEnabledUi).toBe(false);
  });

  it('records who turned the statistics off', async () => {
    const instance = service();
    await instance.setStatsEnabledUi('user-1', false);
    const record = await instance.read();
    expect(record.statsEnabledUi).toBe(false);
    expect(record.statsEnabledChangedBy).toBe('user-1');
    expect(typeof record.statsEnabledChangedAt).toBe('number');
    expect(await instance.isStatsEnabledUi()).toBe(false);
  });

  it('leaves the switch to the deployment on a cloud install', async () => {
    await expect(service({ installSource: 'cloud' }).setStatsEnabledUi('user-1', false)).rejects.toMatchObject({ code: 'cloud_managed' });
  });

  it('knows the operators: listed users only, never an API client', () => {
    const instance = service();
    expect(instance.isOperator(user('operator@example.com'))).toBe(true);
    expect(instance.isOperator(user(' OPERATOR@example.com '))).toBe(true);
    expect(instance.isOperator(user('someone@example.com'))).toBe(false);
    expect(instance.isOperator(new ProjectClient())).toBe(false);
    expect(instance.isOperator({ email: 'operator@example.com' })).toBe(false);
    expect(instance.isOperator(undefined)).toBe(false);
  });
});

describe('EverAdminGuard', () => {
  const contextFor = (requestUser: unknown) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ user: requestUser }) }),
    }) as unknown as ExecutionContext;

  const guard = () => {
    const instance = new EverInstanceService(null, settings());
    const g = new EverAdminGuard(instance);
    // The JWT check itself is passport's; here the request is already authenticated
    jest.spyOn(Object.getPrototypeOf(EverAdminGuard.prototype), 'canActivate').mockResolvedValue(true);
    return g;
  };

  afterEach(() => jest.restoreAllMocks());

  it('accepts a listed operator', async () => {
    await expect(guard().canActivate(contextFor(user('operator@example.com')))).resolves.toBe(true);
  });

  it('refuses another user and an API client', async () => {
    await expect(guard().canActivate(contextFor(user('someone@example.com')))).rejects.toMatchObject({ status: 403 });
    await expect(guard().canActivate(contextFor(new ProjectClient()))).rejects.toMatchObject({ status: 403 });
  });
});

describe('key wrapping', () => {
  it('round-trips and fails closed', () => {
    const der = Buffer.from('a private key, in a test');
    const blob = wrapStatsKey(der, SECRET, 'instance-1');
    expect(unwrapStatsKey(blob, SECRET, 'instance-1').equals(der)).toBe(true);
    expect(() => unwrapStatsKey(blob, 'another', 'instance-1')).toThrow(EverInstanceKeyError);
    expect(() => unwrapStatsKey(blob, SECRET, 'instance-2')).toThrow(EverInstanceKeyError);
    expect(() => unwrapStatsKey('v2:x:y:z', SECRET, 'instance-1')).toThrow(EverInstanceKeyError);
    expect(() => wrapStatsKey(der, '', 'instance-1')).toThrow(EverInstanceKeyError);
  });

  it('signs bytes that the public key verifies, and only those', async () => {
    const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [EverInstance], synchronize: true });
    await dataSource.initialize();
    try {
      const instance = new EverInstanceService(dataSource.getRepository(EverInstance), settings());
      const { record, privateKeyDer } = await instance.signingIdentity();
      const bytes = Buffer.from('{"schema":"ever.stats.v1"}');
      const signature = signBytes(privateKeyDer, bytes);
      expect(verifyBytes(record.statsPublicKey, bytes, signature)).toBe(true);
      const tampered = Buffer.from(bytes);
      tampered[3] = tampered[3] + 1;
      expect(verifyBytes(record.statsPublicKey, tampered, signature)).toBe(false);
    } finally {
      await dataSource.destroy();
    }
  });
});
