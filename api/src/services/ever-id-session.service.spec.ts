import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { config } from '../config';
import { EverIdLogoutJti } from '../entity/ever-id-logout-jti.entity';
import { EverIdSession } from '../entity/ever-id-session.entity';
import { IdentityLinkMethod, UserIdentity } from '../entity/user-identity.entity';
import { User } from '../entity/user.entity';
import { SnakeNamingStrategy } from '../utils/snake-naming-strategy';
import { EverIdSessionService, SESSION_RETENTION_MS } from './ever-id-session.service';
import { OidcProviderService } from './oidc-provider.service';

// Runs the real migrations on an in-memory SQLite database: they follow TR_DB_TYPE, so only when it is SQLite (the
// default); the e2e suite covers the other databases
const describeOnSqlite = config.db.default.type === 'better-sqlite3' ? describe : describe.skip;

describeOnSqlite('EverIdSessionService', () => {
  let dataSource: DataSource;
  let service: EverIdSessionService;
  let alice: User;
  let bob: User;

  const identity = (subject: string) => ({
    provider: 'everid',
    issuer: 'https://idp.example.test',
    subject,
    email: `${subject}@example.test`,
    name: subject,
    personId: `person-${subject}`,
  });

  const createUser = async (email: string, password?: string) => {
    const users = dataSource.getRepository(User);
    return users.save(users.create({ name: email, email, encryptedPassword: password ? Buffer.from(password) : null }));
  };

  beforeEach(async () => {
    // The real migrations on an in-memory SQLite database
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      foreignKeys: true,
      entities: [join(__dirname, '../entity/*.entity.ts')],
      migrations: [join(__dirname, '../migrations/*.ts')],
      namingStrategy: new SnakeNamingStrategy(),
      logging: false,
    } as DataSourceOptions);
    await dataSource.initialize();
    await dataSource.runMigrations();
    const oidcProviders = { isActive: () => false } as unknown as OidcProviderService;
    service = new EverIdSessionService(
      dataSource.getRepository(UserIdentity),
      dataSource.getRepository(EverIdSession),
      dataSource.getRepository(EverIdLogoutJti),
      dataSource.getRepository(User),
      oidcProviders,
    );
    alice = await createUser('alice@example.test', 'hashed-password');
    bob = await createUser('bob@example.test');
  });

  afterEach(async () => {
    service.onModuleDestroy();
    await dataSource.destroy();
  });

  describe('identities', () => {
    it('attaches an identity once: the issuer and subject are unique', async () => {
      const linked = await service.link(alice.id, identity('s1'), IdentityLinkMethod.Explicit);
      expect(linked).toBeDefined();
      expect(await service.link(bob.id, identity('s1'), IdentityLinkMethod.Jit)).toBeUndefined();

      const found = await service.findIdentity('https://idp.example.test', 's1');
      expect(found.user.id).toBe(alice.id);
      expect(found.everPersonId).toBe('person-s1');
      expect(found.linkMethod).toBe('explicit');
      expect(await service.findIdentity('https://other.example.test', 's1')).toBeNull();
    });

    it('lists the identities of an account without subject or token', async () => {
      await service.link(alice.id, identity('s1'), IdentityLinkMethod.Explicit);
      const list = await service.listForUser(alice.id);
      expect(list).toHaveLength(1);
      expect(Object.keys(list[0]).sort()).toEqual(['email', 'id', 'lastLoginAt', 'linkMethod', 'linkedAt', 'provider']);
      expect(list[0].email).toBe('s1@example.test');
      expect(await service.listForUser(bob.id)).toEqual([]);
    });

    it('records the last sign-in', async () => {
      const linked = await service.link(alice.id, identity('s1'), IdentityLinkMethod.Explicit);
      expect((await service.findIdentity(linked.issuer, linked.subject)).lastLoginAt).toBeNull();
      await service.touchLastLogin(linked.id);
      expect((await service.findIdentity(linked.issuer, linked.subject)).lastLoginAt).toBeInstanceOf(Date);
    });

    it('never removes the last way to sign in to an account', async () => {
      const bobs = await service.link(bob.id, identity('s2'), IdentityLinkMethod.Jit);
      expect(await service.unlink(bob.id, bobs.id)).toBe('last_sign_in_method');
      expect(await service.unlink(alice.id, bobs.id)).toBe('not_found');

      const alices = await service.link(alice.id, identity('s1'), IdentityLinkMethod.Explicit);
      expect(await service.unlink(alice.id, alices.id)).toBe('removed');
      expect(await service.listForUser(alice.id)).toEqual([]);
    });

    it('removes the identities of a deleted account', async () => {
      await service.link(bob.id, identity('s2'), IdentityLinkMethod.Jit);
      await dataSource.getRepository(User).delete({ id: bob.id });
      expect(await service.findIdentity('https://idp.example.test', 's2')).toBeNull();
    });
  });

  describe('sealed pending records', () => {
    const pending = { provider: 'everid', issuer: 'https://idp.example.test', subject: 's1', email: 'a@example.test', name: 'A' };

    it('opens what it sealed, for the same purpose only', () => {
      const sealed = service.seal({ purpose: 'signup', ...pending }, 600);
      expect(sealed).not.toContain('a@example.test');
      expect(service.unseal(sealed, 'signup')).toMatchObject(pending);
      expect(service.unseal(sealed, 'connect')).toBeUndefined();
    });

    it('refuses a changed, foreign or expired record', () => {
      const sealed = service.seal({ purpose: 'connect', userId: alice.id, ...pending }, 300);
      const tampered = sealed.slice(0, -2) + (sealed.endsWith('AA') ? 'BB' : 'AA');
      expect(service.unseal(tampered, 'connect')).toBeUndefined();
      expect(service.unseal('v1.bm90LXNlYWxlZA', 'connect')).toBeUndefined();
      expect(service.unseal(undefined, 'connect')).toBeUndefined();
      expect(service.unseal(service.seal({ purpose: 'connect', ...pending }, -1), 'connect')).toBeUndefined();
    });
  });

  describe('sessions and back-channel logout', () => {
    it('opens a session per provider session and ends it by sid', async () => {
      const session = await service.openSession(alice.id, 'sid-1');
      expect(session.sid).toBe('sid-1');
      expect(await service.isRevoked('sid-1', alice.id)).toBe(false);
      // Another account never uses this session
      expect(await service.isRevoked('sid-1', bob.id)).toBe(true);
      expect(await service.isRevoked('unknown-sid', alice.id)).toBe(true);

      // Signing in again with the same provider session keeps it
      const again = await service.openSession(alice.id, 'sid-1');
      expect(again.sid).toBe('sid-1');
      expect(again.jti).not.toBe(session.jti);

      expect(await service.revokeSid('sid-1')).toBe(1);
      expect(await service.isRevoked('sid-1', alice.id)).toBe(true);
      // An ended provider session cannot be opened again
      expect(await service.openSession(alice.id, 'sid-1')).toBeUndefined();
    });

    it('leaves other sessions open', async () => {
      await service.openSession(alice.id, 'sid-1');
      await service.openSession(bob.id, 'sid-2');
      await service.revokeSid('sid-1');
      expect(await service.isRevoked('sid-2', bob.id)).toBe(false);
    });

    it('uses a local session id when the provider sends none, and ends it by subject', async () => {
      await service.link(alice.id, identity('s1'), IdentityLinkMethod.Explicit);
      const session = await service.openSession(alice.id, undefined);
      expect(session.sid).toMatch(/^local-[0-9a-f]{32}$/);
      await service.openSession(bob.id, 'sid-bob');
      expect(await service.revokeIdentity('https://idp.example.test', 's1')).toBe(1);
      expect(await service.isRevoked(session.sid, alice.id)).toBe(true);
      expect(await service.isRevoked('sid-bob', bob.id)).toBe(false);
    });

    it('accepts a logout token id once, and again after it was released', async () => {
      expect(await service.rememberLogoutJti('jti-1')).toBe(true);
      expect(await service.rememberLogoutJti('jti-1')).toBe(false);
      await service.releaseLogoutJti('jti-1');
      expect(await service.rememberLogoutJti('jti-1')).toBe(true);
    });

    it('deletes sessions a day after they expire and expired logout token ids', async () => {
      await service.openSession(alice.id, 'sid-old');
      await service.openSession(alice.id, 'sid-new');
      await dataSource
        .getRepository(EverIdSession)
        .update({ sid: 'sid-old' }, { expiresAt: new Date(Date.now() - SESSION_RETENTION_MS - 60 * 1000) });
      await service.rememberLogoutJti('jti-old');
      await dataSource.getRepository(EverIdLogoutJti).update({ jti: 'jti-old' }, { expiresAt: new Date(Date.now() - 1000) });
      await service.rememberLogoutJti('jti-new');

      await service.sweep();

      const sessions = await dataSource.getRepository(EverIdSession).find();
      expect(sessions.map(session => session.sid)).toEqual(['sid-new']);
      const jtis = await dataSource.getRepository(EverIdLogoutJti).find();
      expect(jtis.map(row => row.jti)).toEqual(['jti-new']);
    });
  });
});
