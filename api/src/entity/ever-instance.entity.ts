import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * The anonymous identity of this installation: one row (`id = 'self'`), created the first time the anonymous usage
 * statistics need it. Columns carry explicit names, so sqlite, postgres and mysql share one column set.
 */
@Entity('ever_instance')
export class EverInstance {
  @PrimaryColumn({ type: 'varchar', length: 8, name: 'id' })
  id: string;

  /** Opaque UUID v4: the `instance_id` of every statistics report. Not derived from anything. */
  @Column({ type: 'varchar', length: 36, name: 'instance_id' })
  instanceId: string;

  /** The statistics public key: base64url of the raw 32-byte Ed25519 key (43 characters). */
  @Column({ type: 'varchar', length: 64, name: 'stats_public_key' })
  statsPublicKey: string;

  /** The statistics private key (PKCS#8 DER), encrypted with AES-256-GCM (see `ever-instance/key-wrap.ts`). */
  @Column({ type: 'text', name: 'stats_private_key_enc' })
  statsPrivateKeyEnc: string;

  /** base64url of the first 8 bytes of the SHA-256 of the raw public key (11 characters). */
  @Column({ type: 'varchar', length: 16, name: 'stats_key_id' })
  statsKeyId: string;

  /** The operator's switch on the Statistics page; on unless the operator turned it off. */
  @Column({ type: 'boolean', name: 'stats_enabled_ui', default: true })
  statsEnabledUi: boolean;

  @Column({ type: 'bigint', name: 'stats_enabled_changed_at', nullable: true, transformer: epochMsTransformer })
  statsEnabledChangedAt: number | null;

  /** The id of the user who last turned the switch on or off (no e-mail). */
  @Column({ type: 'varchar', length: 36, name: 'stats_enabled_changed_by', nullable: true })
  statsEnabledChangedBy: string | null;

  @Column({ type: 'bigint', name: 'created_at', transformer: epochMsTransformer })
  createdAt: number;

  /** How many times the identity was reset (by the operator, or because the stored key could no longer be read). */
  @Column({ type: 'int', name: 'reset_count', default: 0 })
  resetCount: number;

  @Column({ type: 'bigint', name: 'reset_at', nullable: true, transformer: epochMsTransformer })
  resetAt: number | null;
}
