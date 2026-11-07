import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { EntityManager, IsNull, LessThan, Repository } from 'typeorm';
import { config } from '../config';
import { EverIdLogoutJti } from '../entity/ever-id-logout-jti.entity';
import { EverIdSession } from '../entity/ever-id-session.entity';
import { IdentityLinkMethod, UserIdentity } from '../entity/user-identity.entity';
import { User } from '../entity/user.entity';
import { DbType, isDbType } from '../utils/database-type-helper';
import { OidcIdentity, OidcProviderService } from './oidc-provider.service';

/** A sign-up waits at most 10 minutes for its confirmation. */
export const SIGNUP_PENDING_TTL_SECONDS = 600;

/** A connect from settings waits at most 5 minutes for its confirmation. */
export const CONNECT_PENDING_TTL_SECONDS = 300;

/** Ids of processed logout tokens are kept this long (the tokens themselves are accepted for 300 s). */
export const LOGOUT_JTI_TTL_SECONDS = 600;

/** Sessions are deleted this long after they expire. */
export const SESSION_RETENTION_MS = 24 * 60 * 60 * 1000;

/** Expired rows are deleted this often. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export type PendingPurpose = 'signup' | 'connect';

/** What a sealed sign-up or connect record holds until the person confirms. */
export interface PendingIdentity {
  purpose: PendingPurpose;
  provider: string;
  issuer: string;
  subject: string;
  email: string;
  name: string;
  sid?: string;
  personId?: string;
  // The account a connect was started from
  userId?: string;
  // Seconds since the epoch
  exp: number;
}

/** The sign-in identities of an account as the account's owner sees them. No token, no subject. */
export interface IdentitySummary {
  id: string;
  provider: string;
  email: string;
  linkMethod: string;
  linkedAt: Date;
  lastLoginAt: Date | null;
}

const SEAL_VERSION = 'v1';

/**
 * The key of a provider session (or of a logout token id) in Traduora: scoped by issuer, since a session id or a token
 * id is unique only within its issuer.
 */
export function issuerScopedKey(issuer: string, value: string): string {
  return createHash('sha256').update(`${issuer}\n${value}`).digest('hex');
}

/** Locks the account's row until the transaction ends (SQLite runs one write transaction at a time instead). */
const lockAccount = (entityManager: EntityManager, userId: string) =>
  entityManager.findOne(User, {
    where: { id: userId },
    select: ['id', 'encryptedPassword'],
    ...(isDbType(DbType.BETTER_SQLITE3) ? {} : { lock: { mode: 'pessimistic_write' as const } }),
  });

/**
 * Identities attached to accounts, the sealed records a sign-up or a connect waits in until the person confirms, the
 * sessions opened with a provider and their back-channel logout. Never stores a token of the provider.
 */
@Injectable()
export class EverIdSessionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('EverIdSessionService');
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(
    @InjectRepository(UserIdentity) private readonly identityRepo: Repository<UserIdentity>,
    @InjectRepository(EverIdSession) private readonly sessionRepo: Repository<EverIdSession>,
    @InjectRepository(EverIdLogoutJti) private readonly logoutJtiRepo: Repository<EverIdLogoutJti>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly oidcProviders: OidcProviderService,
  ) {}

  onApplicationBootstrap(): void {
    // Housekeeping only while a provider is on: an install that never enables one runs nothing new
    if (this.oidcProviders.isActive('everid')) {
      this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
      this.sweepTimer.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = undefined;
    }
  }

  // Identities

  findIdentity(issuer: string, subject: string): Promise<UserIdentity | null> {
    return this.identityRepo.findOne({ where: { issuer, subject }, relations: ['user'] });
  }

  async listForUser(userId: string): Promise<IdentitySummary[]> {
    const identities = await this.identityRepo.find({ where: { user: { id: userId } }, order: { linkedAt: 'ASC' } });
    return identities.map(identity => ({
      id: identity.id,
      provider: identity.provider,
      email: identity.emailAtLink,
      linkMethod: identity.linkMethod,
      linkedAt: identity.linkedAt,
      lastLoginAt: identity.lastLoginAt,
    }));
  }

  async hasIdentity(userId: string, provider: string): Promise<boolean> {
    return (await this.identityRepo.count({ where: { user: { id: userId }, provider } })) > 0;
  }

  /**
   * Attaches an identity to an account, which has at most one identity per provider. Returns 'subject_linked' when the
   * identity is attached to an account already (the unique issuer and subject decide, even between concurrent
   * requests), and 'already_linked' when the account has an identity of that provider. The account's row is locked
   * meanwhile, so concurrent changes of its identities run one after the other.
   */
  async link(
    userId: string,
    identity: Omit<PendingIdentity, 'purpose' | 'exp' | 'userId'>,
    method: IdentityLinkMethod,
  ): Promise<UserIdentity | 'subject_linked' | 'already_linked'> {
    try {
      return await this.identityRepo.manager.transaction(async entityManager => {
        await lockAccount(entityManager, userId);
        if ((await entityManager.count(UserIdentity, { where: { user: { id: userId }, provider: identity.provider } })) > 0) {
          return 'already_linked' as const;
        }
        const entity = entityManager.create(UserIdentity, {
          user: { id: userId },
          provider: identity.provider,
          issuer: identity.issuer,
          subject: identity.subject,
          everPersonId: identity.personId ?? null,
          emailAtLink: identity.email,
          linkMethod: method,
          linkedAt: new Date(),
          lastLoginAt: method === IdentityLinkMethod.Jit ? new Date() : null,
        });
        return entityManager.save(entity);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return 'subject_linked';
      }
      throw error;
    }
  }

  async touchLastLogin(identityId: string): Promise<void> {
    await this.identityRepo.update({ id: identityId }, { lastLoginAt: new Date() });
  }

  /**
   * Removes one of the account's identities. Returns 'not_found' when the account has no such identity, and
   * 'last_sign_in_method' when it would leave the account without any way to sign in (no password, no other identity).
   */
  async unlink(userId: string, identityId: string): Promise<'removed' | 'not_found' | 'last_sign_in_method'> {
    // With the account's row locked: two disconnects at once must not remove its last two ways to sign in
    return this.identityRepo.manager.transaction(async entityManager => {
      const user = await lockAccount(entityManager, userId);
      const identity = await entityManager.findOne(UserIdentity, { where: { id: identityId, user: { id: userId } } });
      if (!identity) {
        return 'not_found' as const;
      }
      const identities = await entityManager.count(UserIdentity, { where: { user: { id: userId } } });
      if (!user?.encryptedPassword?.length && identities <= 1) {
        return 'last_sign_in_method' as const;
      }
      await entityManager.delete(UserIdentity, { id: identity.id });
      return 'removed' as const;
    });
  }

  // Sealed pending records

  /**
   * Seals a pending sign-up or connect with a key derived from TR_SECRET (AES-256-GCM): the webapp holds it until the
   * person confirms, and cannot read or change it.
   */
  seal(pending: Omit<PendingIdentity, 'exp'>, ttlSeconds: number): string {
    const record: PendingIdentity = { ...pending, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.sealKey(), iv);
    cipher.setAAD(Buffer.from(SEAL_VERSION));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), 'utf8'), cipher.final()]);
    return `${SEAL_VERSION}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url')}`;
  }

  /** Opens a sealed record of `purpose`. Returns `undefined` when it was tampered with, is of another kind or expired. */
  unseal(sealed: unknown, purpose: PendingPurpose): PendingIdentity | undefined {
    if (typeof sealed !== 'string' || !sealed.startsWith(`${SEAL_VERSION}.`) || sealed.length > 8192) {
      return undefined;
    }
    try {
      const raw = Buffer.from(sealed.slice(SEAL_VERSION.length + 1), 'base64url');
      if (raw.length < 29) {
        return undefined;
      }
      const decipher = createDecipheriv('aes-256-gcm', this.sealKey(), raw.subarray(0, 12));
      decipher.setAAD(Buffer.from(SEAL_VERSION));
      decipher.setAuthTag(raw.subarray(12, 28));
      const record = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8')) as PendingIdentity;
      if (record.purpose !== purpose || typeof record.exp !== 'number' || record.exp < Math.floor(Date.now() / 1000)) {
        return undefined;
      }
      return record;
    } catch {
      return undefined;
    }
  }

  /** The pending record of a verified identity. */
  pendingFrom(provider: string, identity: OidcIdentity): Omit<PendingIdentity, 'purpose' | 'exp'> {
    return {
      provider,
      issuer: identity.issuer,
      subject: identity.subject,
      email: identity.email,
      name: identity.name,
      sid: identity.sid,
      personId: identity.personId,
    };
  }

  private sealKey(): Buffer {
    return createHmac('sha256', config.secret).update('traduora/oidc-pending/v1').digest();
  }

  // Sessions

  /**
   * Records a session opened with a provider. Keyed by the issuer and the provider's session id; without one, a local
   * id is used, so the session can still be ended by a logout that names the subject.
   *
   * @returns The `sid` and `jti` the access token carries, or `undefined` when the provider already ended that session.
   */
  async openSession(userId: string, issuer: string, providerSid: string | undefined): Promise<{ sid: string; jti: string } | undefined> {
    const sid = providerSid ? issuerScopedKey(issuer, providerSid) : `local-${randomBytes(16).toString('hex')}`;
    return this.openSessionWithKey(userId, sid);
  }

  private async openSessionWithKey(userId: string, sid: string): Promise<{ sid: string; jti: string } | undefined> {
    const jti = randomBytes(16).toString('hex');
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + config.authTokenExpires * 1000);

    const existing = await this.sessionRepo.findOne({ where: { sid } });
    if (existing) {
      if (existing.revokedAt || existing.userId !== userId) {
        return undefined;
      }
      const { affected } = await this.sessionRepo.update({ sid, userId, revokedAt: IsNull() }, { jti, issuedAt, expiresAt });
      return affected ? { sid, jti } : undefined;
    }
    try {
      await this.sessionRepo.insert({ sid, userId, jti, issuedAt, expiresAt, revokedAt: null });
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A concurrent sign-in with the same session: use it if it is still open for this account
        return this.openSessionWithKey(userId, sid);
      }
      throw error;
    }
    return { sid, jti };
  }

  /**
   * Whether an access token carrying `sid` may no longer be used: its session ended, belongs to another account, or
   * is unknown. Access tokens without a `sid` (password, API client, Google) are never checked here.
   */
  async isRevoked(sid: string, userId: string): Promise<boolean> {
    const session = await this.sessionRepo.findOne({ where: { sid }, select: ['sid', 'userId', 'revokedAt'] });
    return !session || session.userId !== userId || !!session.revokedAt;
  }

  /**
   * Ends the sessions opened with a provider session. A session not opened yet (e.g. a sign-up still waiting for its
   * confirmation) is recorded as ended, so it can no longer be opened.
   */
  async revokeSid(issuer: string, providerSid: string): Promise<number> {
    const sid = issuerScopedKey(issuer, providerSid);
    const now = new Date();
    const { affected } = await this.sessionRepo.update({ sid, revokedAt: IsNull() }, { revokedAt: now });
    if (!affected && !(await this.sessionRepo.existsBy({ sid }))) {
      try {
        await this.sessionRepo.insert({ sid, userId: '', jti: '', issuedAt: now, expiresAt: now, revokedAt: now });
      } catch (error) {
        if (!isUniqueViolation(error)) {
          throw error;
        }
        // Opened meanwhile: end it
        return this.revokeSid(issuer, providerSid);
      }
    }
    return affected ?? 0;
  }

  /** Ends every session opened with the identity (a logout naming only the subject). */
  async revokeIdentity(issuer: string, subject: string): Promise<number> {
    const identities = await this.identityRepo.find({ where: { issuer, subject }, relations: ['user'] });
    let revoked = 0;
    for (const identity of identities) {
      const { affected } = await this.sessionRepo.update({ userId: identity.user.id, revokedAt: IsNull() }, { revokedAt: new Date() });
      revoked += affected ?? 0;
    }
    return revoked;
  }

  /**
   * Remembers the id of a logout token. Returns false when it was seen already: a copy of the token is refused.
   */
  async rememberLogoutJti(issuer: string, jti: string): Promise<boolean> {
    try {
      await this.logoutJtiRepo.insert({ jti: issuerScopedKey(issuer, jti), expiresAt: new Date(Date.now() + LOGOUT_JTI_TTL_SECONDS * 1000) });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        return false;
      }
      throw error;
    }
  }

  /** Forgets a logout token id, so the issuer can send the same logout again after a failure here. */
  async releaseLogoutJti(issuer: string, jti: string): Promise<void> {
    await this.logoutJtiRepo.delete({ jti: issuerScopedKey(issuer, jti) });
  }

  /** Deletes sessions a day after they expired, and logout token ids once they expired. */
  async sweep(): Promise<void> {
    try {
      const now = Date.now();
      await this.sessionRepo.delete({ expiresAt: LessThan(new Date(now - SESSION_RETENTION_MS)) });
      await this.logoutJtiRepo.delete({ expiresAt: LessThan(new Date(now)) });
    } catch (error) {
      this.logger.warn(`Could not delete expired sign-in sessions: ${error?.message ?? 'unexpected error'}`);
    }
  }
}

/** Whether a database error is a unique or primary key violation, on any of the supported databases. */
export function isUniqueViolation(error: any): boolean {
  return (
    error?.code === 'ER_DUP_ENTRY' || // MySQL
    error?.code === '23505' || // PostgreSQL
    error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    error?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    error?.driverError?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    error?.driverError?.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    (typeof error?.message === 'string' && error.message.includes('UNIQUE constraint failed'))
  );
}
