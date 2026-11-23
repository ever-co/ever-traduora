import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * When the anonymous statistics are sent, shared by every API process of the installation: one row (`id = 'stats'`).
 * It also holds the sending lease, so that when several processes share one database only one of them sends.
 */
@Entity('ever_stats_schedule')
export class EverStatsSchedule {
  @PrimaryColumn({ type: 'varchar', length: 16, name: 'id' })
  id: string;

  /** The process holding the sending lease (a random id, nothing else). */
  @Column({ type: 'varchar', length: 64, name: 'leased_by', nullable: true })
  leasedBy: string | null;

  @Column({ type: 'bigint', name: 'lease_until', nullable: true, transformer: epochMsTransformer })
  leaseUntil: number | null;

  @Column({ type: 'bigint', name: 'first_boot_at', nullable: true, transformer: epochMsTransformer })
  firstBootAt: number | null;

  @Column({ type: 'bigint', name: 'next_send_at', nullable: true, transformer: epochMsTransformer })
  nextSendAt: number | null;

  @Column({ type: 'bigint', name: 'last_sent_at', nullable: true, transformer: epochMsTransformer })
  lastSentAt: number | null;

  @Column({ type: 'bigint', name: 'last_attempt_at', nullable: true, transformer: epochMsTransformer })
  lastAttemptAt: number | null;

  @Column({ type: 'varchar', length: 16, name: 'last_status', nullable: true })
  lastStatus: string | null;

  /** The past month whose closing report was sent (`YYYY-MM`). */
  @Column({ type: 'varchar', length: 7, name: 'last_final_sent_for', nullable: true })
  lastFinalSentFor: string | null;

  /** How many backed-off retries of the current slot were made. */
  @Column({ type: 'int', name: 'retry_attempt', default: 0 })
  retryAttempt: number;

  /** After a `422`, nothing is sent again until the module version changes. */
  @Column({ type: 'varchar', length: 16, name: 'blocked_module_version', nullable: true })
  blockedModuleVersion: string | null;

  @Column({ type: 'bigint', name: 'last_manual_send_at', nullable: true, transformer: epochMsTransformer })
  lastManualSendAt: number | null;
}
