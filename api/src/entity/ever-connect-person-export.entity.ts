import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * A person's export, made for one export request and one Traduora account: the account's own data as JSON, encrypted
 * with AES-256-GCM under a key derived from `TR_SECRET`. Only that account can download it, for 7 days; then it is
 * deleted.
 */
@Entity('ever_connect_person_export')
export class EverConnectPersonExport {
  /** The export request (`job_id`). */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'job_id' })
  jobId: string;

  /** The Traduora account the export is of, and the only one that may download it. */
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'user_id' })
  userId: string;

  /** The export, encrypted (see `ever-instance/key-wrap.ts`). */
  @Column({ type: 'text', name: 'bundle_enc' })
  bundleEnc: string;

  @Column({ type: 'bigint', name: 'created_at', transformer: epochMsTransformer })
  createdAt: number;

  @Column({ type: 'bigint', name: 'expires_at', transformer: epochMsTransformer })
  expiresAt: number;
}
