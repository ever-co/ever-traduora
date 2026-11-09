import { Column, Entity, PrimaryColumn } from 'typeorm';
import { NumberColumnType, TimeColumnType } from '../utils/database-type-helper';

/** The id of the only row of `ever_stats_schedule` (seeded by the migration). */
export const EVER_STATS_SCHEDULE_ID = 'stats';

/**
 * When the next anonymous usage statistics report is due, and what the last ones answered. Shared by every API process
 * of the installation, and read again under the lease before each report.
 */
@Entity('ever_stats_schedule')
export class EverStatsSchedule {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 16 })
  id: string;

  @Column({ name: 'next_send_at', ...TimeColumnType.date() })
  nextSendAt: Date | null;

  @Column({ name: 'last_sent_at', ...TimeColumnType.date() })
  lastSentAt: Date | null;

  @Column({ name: 'last_attempt_at', ...TimeColumnType.date() })
  lastAttemptAt: Date | null;

  @Column({ name: 'last_status', type: 'varchar', length: 16, nullable: true })
  lastStatus: string | null;

  // The closed month (YYYY-MM) whose final report was sent (or refused) on days 1-3
  @Column({ name: 'last_final_sent_for', type: 'varchar', length: 7, nullable: true })
  lastFinalSentFor: string | null;

  // How many retries after a failure (429, 5xx, no answer) were used: +1 h, +4 h, +12 h, then the next day
  @Column({ name: 'retry_attempt', ...NumberColumnType.integer(0) })
  retryAttempt: number;

  // After an answer 422, nothing is sent again until the statistics module version changes
  @Column({ name: 'blocked_module_version', type: 'varchar', length: 16, nullable: true })
  blockedModuleVersion: string | null;

  // Send now is accepted once per 10 minutes
  @Column({ name: 'last_manual_send_at', ...TimeColumnType.date() })
  lastManualSendAt: Date | null;
}
