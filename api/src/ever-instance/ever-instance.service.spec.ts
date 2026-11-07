import { ExecutionContext, HttpStatus } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { describeOnSqlite, memoryDatabase } from '../../test/memory-database';
import { config } from '../config';
import { EverInstance } from '../entity/ever-instance.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { User } from '../entity/user.entity';
import { EverPlatformException } from '../errors';
import { EverAdminGuard } from './ever-admin.guard';
import { EverInstanceService } from './ever-instance.service';
import { keyIdOf, publicKeyOfPrivate, signBytes, unwrapStatsKey, verifyBytes, wrapStatsKey } from './key-wrap';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('statistics key at rest', () => {
  const secret = 'a-test-secret-'.padEnd(64, 'x');
  const der = Buffer.from('not a real key, only bytes to wrap');

  it('round-trips, with a fresh IV every time', () => {
    const one = wrapStatsKey(der, secret, 'instance-a');
    const two = wrapStatsKey(der, secret, 'instance-a');
    expect(one).not.toEqual(two);
    expect(one).toMatch(/^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]+$/);
    expect(unwrapStatsKey(one, secret, 'instance-a')).toEqual(der);
  });

  it('cannot be read with another secret or for another instance', () => {
    const blob = wrapStatsKey(der, secret, 'instance-a');
    expect(() => unwrapStatsKey(blob, 'another-secret'.padEnd(64, 'y'), 'instance-a')).toThrow(/unreadable/);
    expect(() => unwrapStatsKey(blob, secret, 'instance-b')).toThrow(/unreadable/);
    expect(() => unwrapStatsKey('garbage', secret, 'instance-a')).toThrow(/malformed/);
  });
});

describeOnSqlite('EverInstanceService', () => {
  const original = { secret: config.secret, everPlatform: { ...config.everPlatform } };
  let dataSource: DataSource;
  let service: EverInstanceService;

  beforeEach(async () => {
    config.secret = 'the-secret-of-this-test-'.padEnd(64, 's');
    Object.assign(config.everPlatform, { secretConfigured: true, installSource: 'self-hosted', adminEmails: ['operator@example.test'] });
    dataSource = await memoryDatabase();
    service = new EverInstanceService(dataSource.getRepository(EverInstance));
  });

  afterEach(async () => {
    config.secret = original.secret;
    Object.assign(config.everPlatform, original.everPlatform);
    await dataSource.destroy();
  });

  const rows = () => dataSource.getRepository(EverInstance).find();

  it('creates one identity: a v4 id and an Ed25519 statistics key', async () => {
    const record = await service.ensure();
    expect(record.id).toBe('self');
    expect(record.instanceId).toMatch(UUID_V4);
    expect(record.statsPublicKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record.statsKeyId).toBe(keyIdOf(record.statsPublicKey));
    expect(record.statsEnabledUi).toBe(true);
    expect(record.resetCount).toBe(0);
    expect(await service.ensure()).toEqual(record);
  });

  it('leaves one row when two calls race', async () => {
    const [a, b] = await Promise.all([service.ensure(), service.ensure()]);
    expect(a.instanceId).toBe(b.instanceId);
    expect(await rows()).toHaveLength(1);
  });

  it('never stores the private key in clear', async () => {
    const record = await service.ensure();
    const { privateKeyDer } = await service.signingIdentity();
    const stored = JSON.stringify(await rows());
    expect(record.statsPrivateKeyEnc.startsWith('v1:')).toBe(true);
    for (const encoding of ['base64', 'base64url', 'hex'] as const) {
      expect(stored).not.toContain(privateKeyDer.toString(encoding));
      expect(stored).not.toContain(privateKeyDer.subarray(16).toString(encoding));
    }
    expect(publicKeyOfPrivate(privateKeyDer)).toBe(record.statsPublicKey);
    const signature = signBytes(privateKeyDer, Buffer.from('bytes'));
    expect(verifyBytes(record.statsPublicKey, Buffer.from('bytes'), signature)).toBe(true);
    expect(JSON.stringify(service.publicView(record))).not.toContain(record.statsPrivateKeyEnc);
  });

  it('cannot use the key after TR_SECRET changed', async () => {
    const record = await service.ensure();
    expect(service.keyState(record)).toBe('ok');
    config.secret = 'a-different-secret-'.padEnd(64, 'd');
    expect(service.keyState(record)).toBe('key_unreadable');
    await expect(service.signingIdentity()).rejects.toThrow(/unreadable/);
  });

  it('sends nothing without TR_SECRET', async () => {
    config.everPlatform.secretConfigured = false;
    const record = await service.ensure();
    expect(service.keyState(record)).toBe('secret_missing');
    await expect(service.signingIdentity()).rejects.toThrow(/secret_missing/);
  });

  it('records who switched the statistics off, by user id', async () => {
    await service.setStatsEnabledUi('user-1', false);
    const [row] = await rows();
    expect(row.statsEnabledUi).toBe(false);
    expect(row.statsEnabledChangedBy).toBe('user-1');
    expect(row.statsEnabledChangedAt).toBeInstanceOf(Date);
    expect(await service.isStatsEnabledUi()).toBe(false);
    await service.setStatsEnabledUi('user-2', true);
    expect(await service.isStatsEnabledUi()).toBe(true);
  });

  it('refuses the switch on Ever Cloud (cloud-managed)', async () => {
    config.everPlatform.installSource = 'cloud';
    await expect(service.setStatsEnabledUi('user-1', false)).rejects.toMatchObject({ code: 'cloud-managed', status: HttpStatus.CONFLICT });
    expect(await service.isStatsEnabledUi()).toBe(true);
  });

  it('resets the identity: a new id and key, the switch kept, the reset counted', async () => {
    const before = await service.ensure();
    await service.setStatsEnabledUi('user-1', false);
    const after = await service.resetIdentity('user-1');
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(after.statsPublicKey).not.toBe(before.statsPublicKey);
    expect(after.statsKeyId).toBe(keyIdOf(after.statsPublicKey));
    expect(after.resetCount).toBe(1);
    expect(after.statsEnabledUi).toBe(false);
    expect(service.keyState(after)).toBe('ok');
    expect((await service.resetIdentity(null)).resetCount).toBe(2);
    expect(await rows()).toHaveLength(1);
  });

  describe('operator guard', () => {
    const guardFor = () => new EverAdminGuard(service);
    const contextWith = (user: unknown) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ user }) }), getHandler: () => null, getClass: () => null }) as unknown as ExecutionContext;
    const userWith = (email: string) => Object.assign(new User(), { id: 'u', email });

    beforeEach(() => {
      // The JWT check itself is the existing passport guard (covered end to end); here only what follows it
      jest.spyOn(Object.getPrototypeOf(EverAdminGuard.prototype), 'canActivate').mockResolvedValue(true);
    });

    afterEach(() => jest.restoreAllMocks());

    it('accepts the operator, whatever the case of the e-mail', async () => {
      await expect(guardFor().canActivate(contextWith(userWith('Operator@Example.TEST')))).resolves.toBe(true);
    });

    it('refuses another user with 403', async () => {
      await expect(guardFor().canActivate(contextWith(userWith('someone@example.test')))).rejects.toBeInstanceOf(EverPlatformException);
      await expect(guardFor().canActivate(contextWith(userWith('someone@example.test')))).rejects.toMatchObject({ status: 403 });
    });

    it('refuses an API client token with 403', async () => {
      const client = Object.assign(new ProjectClient(), { id: 'client-1' });
      await expect(guardFor().canActivate(contextWith(client))).rejects.toMatchObject({ status: 403, code: 'not_operator' });
    });

    it('follows TR_EVER_ADMIN_EMAILS (default TR_ADMIN_EMAIL)', async () => {
      config.everPlatform.adminEmails = ['first@example.test', 'second@example.test'];
      await expect(guardFor().canActivate(contextWith(userWith('second@example.test')))).resolves.toBe(true);
      await expect(guardFor().canActivate(contextWith(userWith('operator@example.test')))).rejects.toMatchObject({ status: 403 });
    });
  });
});
