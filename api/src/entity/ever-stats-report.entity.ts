import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';
import { NumberColumnType, TimeColumnType } from '../utils/database-type-helper';

/** What became of a statistics report. */
export type EverStatsReportStatus = 'pending' | 'sent' | 'rejected' | 'failed';

/**
 * One anonymous usage statistics report, as it was sent (or refused): the exact bytes, the signature, the answer. Only
 * the last 12 rows are kept, so the operator can read what left the installation.
 *
 * Every column has an explicit snake_case name, so the same columns exist on every database.
 */
@Entity('ever_stats_report')
export class EverStatsReport {
  // The report_id of the report
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 36 })
  id: string;

  // The installation id the report was built for (a report of an identity that was reset since is never kept)
  @Column({ name: 'instance_id', type: 'varchar', length: 36 })
  instanceId: string;

  // YYYY-MM (UTC)
  @Column({ name: 'period', type: 'varchar', length: 7 })
  period: string;

  @Column({ name: 'final', type: 'boolean', default: false })
  final: boolean;

  // The exact bytes sent, as UTF-8 text
  @Column({ name: 'payload', type: 'text' })
  payload: string;

  // ed25519=<base64url signature of payload>; empty when nothing was signed
  @Column({ name: 'signature', type: 'text' })
  signature: string;

  @Column({ name: 'sent_at', ...TimeColumnType.date() })
  sentAt: Date | null;

  @Column({ name: 'http_status', type: 'int', nullable: true })
  httpStatus: number | null;

  @Column({ name: 'status', type: 'varchar', length: 16 })
  status: EverStatsReportStatus;

  @Column({ name: 'attempts', ...NumberColumnType.integer(0) })
  attempts: number;

  @Column({ name: 'next_attempt_at', ...TimeColumnType.date() })
  nextAttemptAt: Date | null;

  // Why the report was refused or failed: a code and a redacted field path, never a value
  @Column({ name: 'error', type: 'varchar', length: 128, nullable: true })
  error: string | null;

  // A suggested operator action, such as reset_identity after an answer 409
  @Column({ name: 'hint', type: 'varchar', length: 32, nullable: true })
  hint: string | null;

  @CreateDateColumn({ name: 'created_at', ...TimeColumnType.createDate() })
  createdAt: Date;
}
