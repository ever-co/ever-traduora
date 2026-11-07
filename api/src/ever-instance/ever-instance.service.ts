import { HttpStatus, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { config, normalizeEmail } from '../config';
import { EVER_INSTANCE_ROW_ID, EverInstance } from '../entity/ever-instance.entity';
import { User } from '../entity/user.entity';
import { EverPlatformException } from '../errors';
import { EverInstanceKeyError, generateStatsKeyPair, keyIdOf, unwrapStatsKey, wrapStatsKey } from './key-wrap';

/** Whether the stored statistics key can be used: `secret_missing` without TR_SECRET, `key_unreadable` after it changed. */
export type EverInstanceKeyState = 'ok' | 'secret_missing' | 'key_unreadable';

/** The identity and its decrypted statistics key, for signing. Never leaves the process. */
export interface EverInstanceSigningIdentity {
  record: EverInstance;
  privateKeyDer: Buffer;
}

/** What may be shown of the identity: never the private key. */
export interface EverInstancePublicView {
  instanceId: string;
  keyId: string;
  publicKey: string;
  statsEnabledUi: boolean;
  createdAt: Date;
  resetCount: number;
}

/**
 * The anonymous identity of this installation (`ever_instance`, one row): a random id and a statistics-only Ed25519 key
 * pair, created once, the first time they are needed; reset by the operator, or automatically when the stored key can
 * no longer be read because TR_SECRET changed. It also holds the operator's statistics switch. It makes no request.
 */
@Injectable()
export class EverInstanceService implements OnModuleInit {
  private readonly logger = new Logger('EverInstance');

  constructor(@InjectRepository(EverInstance) private readonly repo: Repository<EverInstance>) {}

  onModuleInit(): void {
    if (!config.everPlatform.secretConfigured) {
      this.logger.warn(
        'TR_SECRET is not set: the statistics key of this installation cannot be kept across restarts, so no anonymous usage statistics report is sent until it is set.',
      );
    }
  }

  /** Whether the operator declared this installation as Ever's own cloud (TR_EVER_INSTALL_SOURCE=cloud). */
  isCloudManaged(): boolean {
    return config.everPlatform.installSource === 'cloud';
  }

  /**
   * Whether the signed-in principal operates this installation: a user (never an API client) whose normalized e-mail
   * is one of TR_EVER_ADMIN_EMAILS (default TR_ADMIN_EMAIL).
   */
  isOperator(principal: unknown): boolean {
    if (!(principal instanceof User) || typeof principal.email !== 'string') {
      return false;
    }
    return config.everPlatform.adminEmails.includes(normalizeEmail(principal.email));
  }

  private newIdentity(instanceId: string = randomUUID()) {
    const { publicKey, privateKeyDer } = generateStatsKeyPair();
    return {
      instanceId,
      statsPublicKey: publicKey,
      statsPrivateKeyEnc: wrapStatsKey(privateKeyDer, config.secret, instanceId),
      statsKeyId: keyIdOf(publicKey),
    };
  }

  /** Reads the identity without creating it. */
  async read(): Promise<EverInstance | null> {
    return this.repo.findOne({ where: { id: EVER_INSTANCE_ROW_ID } });
  }

  /**
   * The identity, created when absent. Several API processes on one database end up with one identity: the row is
   * inserted only if it is not there (ON CONFLICT DO NOTHING, INSERT IGNORE, INSERT OR IGNORE), then read back.
   */
  async ensure(): Promise<EverInstance> {
    const existing = await this.read();
    if (existing) {
      return existing;
    }
    const candidate = this.newIdentity();
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(EverInstance)
      .values({ id: EVER_INSTANCE_ROW_ID, ...candidate, statsEnabledUi: true, resetCount: 0 })
      .orIgnore()
      .execute();
    const stored = await this.read();
    if (!stored) {
      throw new Error('The anonymous identity of this installation could not be stored.');
    }
    if (stored.instanceId === candidate.instanceId) {
      this.logger.log('ever_instance.created');
    }
    return stored;
  }

  /** Whether the stored statistics key can be decrypted with the current TR_SECRET. */
  keyState(record: EverInstance): EverInstanceKeyState {
    if (!config.everPlatform.secretConfigured) {
      return 'secret_missing';
    }
    try {
      unwrapStatsKey(record.statsPrivateKeyEnc, config.secret, record.instanceId);
      return 'ok';
    } catch {
      return 'key_unreadable';
    }
  }

  /** The identity with its decrypted statistics key. Throws {@link EverInstanceKeyError} when it cannot be used. */
  async signingIdentity(): Promise<EverInstanceSigningIdentity> {
    const record = await this.ensure();
    if (!config.everPlatform.secretConfigured) {
      throw new EverInstanceKeyError('secret_missing');
    }
    return { record, privateKeyDer: unwrapStatsKey(record.statsPrivateKeyEnc, config.secret, record.instanceId) };
  }

  /** What may be shown of the identity. */
  publicView(record: EverInstance): EverInstancePublicView {
    return {
      instanceId: record.instanceId,
      keyId: record.statsKeyId,
      publicKey: record.statsPublicKey,
      statsEnabledUi: record.statsEnabledUi !== false,
      createdAt: record.createdAt,
      resetCount: record.resetCount ?? 0,
    };
  }

  /** The operator's switch (on unless the operator turned it off). */
  async isStatsEnabledUi(): Promise<boolean> {
    const record = await this.read();
    return record?.statsEnabledUi !== false;
  }

  /**
   * The operator turns the statistics on or off in the settings page; the change and the operator's user id are
   * recorded. Refused on Ever's own cloud, where the deployment decides (409 `cloud-managed`).
   */
  async setStatsEnabledUi(userId: string, enabled: boolean): Promise<EverInstance> {
    if (this.isCloudManaged()) {
      throw new EverPlatformException(HttpStatus.CONFLICT, 'cloud-managed', 'Managed by Ever Cloud: the deployment decides.');
    }
    await this.ensure();
    await this.repo.update(
      { id: EVER_INSTANCE_ROW_ID },
      { statsEnabledUi: enabled, statsEnabledChangedAt: new Date(), statsEnabledChangedBy: userId },
    );
    this.logger.log(`ever_instance.stats_toggle enabled=${enabled} by=${userId}`);
    return this.ensure();
  }

  /**
   * A new instance id and a new statistics key; the switch and the creation time are kept and the reset is counted.
   * `userId` is the operator who asked, or null when the stored key could no longer be read (TR_SECRET changed).
   */
  async resetIdentity(userId: string | null): Promise<EverInstance> {
    await this.ensure();
    const fresh = this.newIdentity();
    await this.repo
      .createQueryBuilder()
      .update(EverInstance)
      .set({ ...fresh, resetCount: () => 'reset_count + 1' })
      .where('id = :id', { id: EVER_INSTANCE_ROW_ID })
      .execute();
    const record = await this.ensure();
    const reason = userId ? 'operator' : 'key_unreadable';
    this.logger.log(`ever_instance.reset reason=${reason} by=${userId ?? 'system'} reset_count=${record.resetCount}`);
    return record;
  }
}
