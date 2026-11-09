import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { NumberColumnType, TimeColumnType } from '../utils/database-type-helper';

/** The id of the only row of `ever_instance`. */
export const EVER_INSTANCE_ROW_ID = 'self';

/**
 * The anonymous identity of this installation (one row, id `self`), used by the optional Ever Platform features: a
 * random id, and a key pair that signs anonymous usage statistics and nothing else. The private key is stored only
 * encrypted (AES-256-GCM, under a key derived from TR_SECRET). The row also holds the operator's statistics switch.
 *
 * Every column has an explicit snake_case name, so the same columns exist on every database.
 */
@Entity('ever_instance')
export class EverInstance {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 8 })
  id: string;

  // A random UUID that identifies the installation (not a person or a company); a reset makes a new one
  @Column({ name: 'instance_id', type: 'varchar', length: 36 })
  instanceId: string;

  // The raw Ed25519 public key, base64url (43 characters)
  @Column({ name: 'stats_public_key', type: 'text' })
  statsPublicKey: string;

  // The PKCS#8 private key, encrypted: v1:<iv>:<tag>:<ciphertext>
  @Column({ name: 'stats_private_key_enc', type: 'text' })
  statsPrivateKeyEnc: string;

  // base64url of the first 8 bytes of the SHA-256 of the raw public key
  @Column({ name: 'stats_key_id', type: 'varchar', length: 16 })
  statsKeyId: string;

  // The operator's switch in the settings page (on unless the operator turned it off)
  @Column({ name: 'stats_enabled_ui', type: 'boolean', default: true })
  statsEnabledUi: boolean;

  @Column({ name: 'stats_enabled_changed_at', ...TimeColumnType.date() })
  statsEnabledChangedAt: Date | null;

  // The id of the user who last changed the switch (never an e-mail address)
  @Column({ name: 'stats_enabled_changed_by', type: 'varchar', length: 36, nullable: true })
  statsEnabledChangedBy: string | null;

  @CreateDateColumn({ name: 'created_at', ...TimeColumnType.createDate() })
  createdAt: Date;

  // How many times the identity was reset (by the operator, or because the stored key could no longer be read)
  @Column({ name: 'reset_count', ...NumberColumnType.integer(0) })
  resetCount: number;
}
