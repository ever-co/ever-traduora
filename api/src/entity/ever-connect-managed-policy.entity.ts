import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * The operator's opt-in to maintenance operations requested from app.ever.co: one row (`id = 'self'`). Nothing runs
 * without it, even when an organization consented. The backup directory is stored encrypted and never shown again.
 */
@Entity('ever_connect_managed_policy')
export class EverConnectManagedPolicy {
  @PrimaryColumn({ type: 'varchar', length: 8, name: 'id' })
  id: string;

  @Column({ type: 'boolean', name: 'opt_in', default: false })
  optIn: boolean;

  /** The kinds the operator allows, as a JSON list. */
  @Column({ type: 'text', name: 'kinds', nullable: true })
  kinds: string | null;

  /** The weekly windows (UTC) operations may run in, as JSON: `[{days: [0-6], from: 'HH:MM', to: 'HH:MM'}]`. */
  @Column({ type: 'text', name: 'windows', nullable: true })
  windows: string | null;

  /** The absolute directory backups are written to, encrypted (see `ever-instance/key-wrap.ts`). */
  @Column({ type: 'text', name: 'backup_dir_enc', nullable: true })
  backupDirEnc: string | null;

  @Column({ type: 'bigint', name: 'updated_at', transformer: epochMsTransformer })
  updatedAt: number;

  /** The user id of the operator who changed it last (no e-mail). */
  @Column({ type: 'varchar', length: 64, name: 'updated_by', nullable: true })
  updatedBy: string | null;
}
