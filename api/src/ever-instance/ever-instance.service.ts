import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { isOperatorAccount } from '../access/operator-check';
import { EverPlatformException } from '../errors';
import { EVER_INSTANCE_SETTINGS, EverInstanceSettings } from './ever-instance.settings';
import { EverInstanceKeyError, generateStatsKeyPair, keyIdOf, unwrapStatsKey, wrapStatsKey } from './key-wrap';

/** The id of the single identity row. */
export const EVER_INSTANCE_ROW_ID = 'self';

/** Whether the stored statistics key can be used. */
export type EverInstanceKeyState = 'ok' | 'key_unreadable' | 'secret_missing';

/** The identity and the decrypted statistics key, for signing. Never leaves the process. */
export interface EverInstanceSigningIdentity {
  record: EverInstance;
  privateKeyDer: Buffer;
}

/** What a response may show of the identity: never the encrypted private key. */
export interface EverInstancePublicView {
  instanceId: string;
  keyId: string;
  publicKey: string;
  statsEnabledUi: boolean;
  createdAt: number;
  resetCount: number;
}

/**
 * The anonymous identity of this installation (the `ever_instance` row `'self'`): created once, the first time it is
 * needed; reset by the operator, or automatically when the stored key can no longer be read (`TR_SECRET` changed). It
 * makes no outbound request.
 */
@Injectable()
export class EverInstanceService implements OnModuleInit {
  private readonly logger = new Logger(EverInstanceService.name);

  constructor(
    @InjectRepository(EverInstance) private readonly repo: Repository<EverInstance>,
    @Inject(EVER_INSTANCE_SETTINGS) private readonly settings: EverInstanceSettings,
  ) {}

  onModuleInit(): void {
    if (!this.settings.secret) {
      this.logger.warn('TR_SECRET is not set: the statistics key of this installation cannot be stored, so no report is sent.');
    }
  }

  /** Whether an identity can be created here: only with a configured `TR_SECRET` to encrypt its key with. */
  canCreateIdentity(): boolean {
    return !!this.settings.secret;
  }

  /** Whether the operator declared this installation as Ever's own cloud (`TR_EVER_INSTALL_SOURCE=cloud`). */
  isCloudManaged(): boolean {
    return this.settings.installSource === 'cloud';
  }

  /**
   * Whether `user` operates this installation: a user (never an API client; the JWT strategy hands a `User` entity to
   * the request) whose e-mail is in `TR_EVER_ADMIN_EMAILS` and confirmed. An unconfirmed account never qualifies: anyone
   * could sign up with a listed address that has no account yet. The rule is `isOperatorAccount`, shared with the
   * operator console.
   */
  isOperator(user: unknown): boolean {
    return isOperatorAccount(user, this.settings.adminEmails);
  }

  private newIdentity(now: number, instanceId = randomUUID()) {
    const { publicKey, privateKeyDer } = generateStatsKeyPair();
    return {
      instanceId,
      statsPublicKey: publicKey,
      statsPrivateKeyEnc: wrapStatsKey(privateKeyDer, this.settings.secret, instanceId),
      statsKeyId: keyIdOf(publicKey),
      createdAt: now,
    };
  }

  /** Reads the identity without creating it. */
  async read(): Promise<EverInstance | null> {
    return this.repo.findOne({ where: { id: EVER_INSTANCE_ROW_ID } });
  }

  /**
   * The identity, created when absent. Several API processes on one database end up with one identity: the row is
   * inserted only when none exists (`INSERT ... ON CONFLICT DO NOTHING` / `INSERT IGNORE`), then read back. A stored key
   * that the configured `TR_SECRET` cannot decrypt is replaced (see {@link resetIdentity}). Without a configured
   * `TR_SECRET`, nothing is created: throws {@link EverInstanceKeyError} `secret_missing`.
   */
  async ensure(): Promise<EverInstance> {
    let record = await this.read();
    if (!record) {
      if (!this.settings.secret) {
        throw new EverInstanceKeyError('secret_missing');
      }
      const now = Date.now();
      await this.repo
        .createQueryBuilder()
        .insert()
        .into(EverInstance)
        .values({ id: EVER_INSTANCE_ROW_ID, ...this.newIdentity(now), statsEnabledUi: true, resetCount: 0 })
        .orIgnore()
        .execute();
      record = await this.read();
      if (!record) {
        throw new Error('The identity of this installation could not be stored.');
      }
    }
    if (this.keyState(record) === 'key_unreadable') {
      this.logger.warn('ever_instance.key_unreadable: TR_SECRET changed since the identity was created; creating a new identity.');
      record = await this.replaceIdentity(record, null);
    }
    return record;
  }

  /** Whether the stored statistics key can be decrypted with the configured `TR_SECRET`. */
  keyState(record: EverInstance): EverInstanceKeyState {
    try {
      unwrapStatsKey(record.statsPrivateKeyEnc, this.settings.secret, record.instanceId);
      return 'ok';
    } catch (error) {
      return error instanceof EverInstanceKeyError && error.code === 'secret_missing' ? 'secret_missing' : 'key_unreadable';
    }
  }

  /** The identity with its decrypted statistics key. Throws {@link EverInstanceKeyError} when it cannot be read. */
  async signingIdentity(): Promise<EverInstanceSigningIdentity> {
    const record = await this.ensure();
    const privateKeyDer = unwrapStatsKey(record.statsPrivateKeyEnc, this.settings.secret, record.instanceId);
    return { record, privateKeyDer };
  }

  /** What may be shown of the identity. */
  publicView(record: EverInstance): EverInstancePublicView {
    return {
      instanceId: record.instanceId,
      keyId: record.statsKeyId,
      publicKey: record.statsPublicKey,
      statsEnabledUi: record.statsEnabledUi !== false,
      createdAt: record.createdAt,
      resetCount: record.resetCount || 0,
    };
  }

  /** The operator's switch (on unless the operator turned it off). */
  async isStatsEnabledUi(): Promise<boolean> {
    const record = await this.read();
    return !record || record.statsEnabledUi !== false;
  }

  /**
   * The operator turns the statistics on or off on the Statistics page. Refused on Ever's own cloud, where the
   * deployment decides (`cloud_managed`). Records when and by whom (the user id, no e-mail).
   */
  async setStatsEnabledUi(userId: string, enabled: boolean): Promise<boolean> {
    if (this.isCloudManaged()) {
      throw new EverPlatformException(HttpStatus.CONFLICT, 'cloud_managed', 'The statistics of this installation are managed by its deployment');
    }
    await this.ensure();
    await this.repo.update(
      { id: EVER_INSTANCE_ROW_ID },
      { statsEnabledUi: enabled, statsEnabledChangedAt: Date.now(), statsEnabledChangedBy: userId },
    );
    this.logger.log(`ever_instance.stats_toggle enabled=${enabled} user=${userId}`);
    return enabled;
  }

  /**
   * A new `instance_id` and a new statistics key, on the operator's request. The operator's switch and the creation time
   * are kept. Logs the user id, never an e-mail.
   */
  async resetIdentity(userId: string): Promise<EverInstance> {
    const current = await this.ensure();
    return this.replaceIdentity(current, userId);
  }

  /**
   * Replaces the identity of `current` unless another process already did (the update only applies while the stored key
   * id is still the one read), then reads the row back.
   */
  private async replaceIdentity(current: EverInstance, userId: string | null): Promise<EverInstance> {
    const now = Date.now();
    const fresh = this.newIdentity(now);
    const result = await this.repo.update(
      { id: EVER_INSTANCE_ROW_ID, statsKeyId: current.statsKeyId },
      {
        instanceId: fresh.instanceId,
        statsPublicKey: fresh.statsPublicKey,
        statsPrivateKeyEnc: fresh.statsPrivateKeyEnc,
        statsKeyId: fresh.statsKeyId,
        resetCount: (current.resetCount || 0) + 1,
        resetAt: now,
      },
    );
    if (result.affected !== 0) {
      this.logger.log(`ever_instance.reset by=${userId ? `user:${userId}` : 'key_unreadable'} reset_count=${(current.resetCount || 0) + 1}`);
    }
    const record = await this.read();
    if (!record) {
      throw new Error('The identity of this installation could not be read.');
    }
    return record;
  }
}
