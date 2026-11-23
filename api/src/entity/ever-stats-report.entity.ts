import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * One anonymous statistics report, kept for the operator: the exact bytes sent (or refused), the signature and Ever
 * Platform's answer. Only the last 12 rows are kept.
 */
@Entity('ever_stats_report')
export class EverStatsReport {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'report_id' })
  reportId: string;

  /** The month the report describes (`YYYY-MM`). */
  @Column({ type: 'varchar', length: 7, name: 'period' })
  period: string;

  /** `true` for the closing report of a past month. */
  @Column({ type: 'boolean', name: 'final', default: false })
  final: boolean;

  /** The exact bytes sent (or refused), as UTF-8 text; empty when nothing could be built. */
  @Column({ type: 'text', name: 'payload' })
  payload: string;

  /** `ed25519=<base64url signature>` of `payload`; empty when nothing was signed. */
  @Column({ type: 'varchar', length: 128, name: 'signature', default: '' })
  signature: string;

  @Column({ type: 'bigint', name: 'created_at', transformer: epochMsTransformer })
  createdAt: number;

  @Column({ type: 'bigint', name: 'sent_at', nullable: true, transformer: epochMsTransformer })
  sentAt: number | null;

  @Column({ type: 'int', name: 'http_status', nullable: true })
  httpStatus: number | null;

  /** `pending`, `sent`, `rejected` or `failed`. */
  @Column({ type: 'varchar', length: 16, name: 'status' })
  status: string;

  @Column({ type: 'int', name: 'attempts', default: 0 })
  attempts: number;

  /** What happens next: `none`, `backoff`, `next_day` or `module_upgrade`. */
  @Column({ type: 'varchar', length: 16, name: 'retry', default: 'none' })
  retry: string;

  /** Why the report was refused or failed: a code and a redacted path, never a value. */
  @Column({ type: 'varchar', length: 160, name: 'error', nullable: true })
  error: string | null;

  /** A suggested operator action, such as `reset_identity` after `409 key_mismatch`. */
  @Column({ type: 'varchar', length: 32, name: 'hint', nullable: true })
  hint: string | null;
}
