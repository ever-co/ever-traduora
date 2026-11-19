import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { EverStatsSchedule } from '../entity/ever-stats-schedule.entity';
import { STATS_SCHEDULE_ID } from './ever-stats.constants';

/** The fields of the schedule row a slot may change (never the lease, which only the lease methods write). */
export type EverStatsSchedulePatch = Partial<Omit<EverStatsSchedule, 'id' | 'leasedBy' | 'leaseUntil'>>;

/**
 * The shared schedule row (`ever_stats_schedule`, id `'stats'`) and its sending lease. The lease is taken with one
 * conditional `UPDATE` (free, expired or already ours), so when several API processes share one database, one of them
 * holds it and sends; the others skip the slot.
 */
export class EverStatsScheduleStore {
  /** This process, as the lease names it (random, nothing else). */
  readonly holderId = randomUUID();

  constructor(
    private readonly repo: Repository<EverStatsSchedule>,
    private readonly leaseMs: number,
  ) {}

  /** Creates the row when it is missing (the migration seeds it; a database restored without it still works). */
  private async ensureRow(): Promise<void> {
    await this.repo.createQueryBuilder().insert().into(EverStatsSchedule).values({ id: STATS_SCHEDULE_ID, retryAttempt: 0 }).orIgnore().execute();
  }

  async read(): Promise<EverStatsSchedule> {
    let row = await this.repo.findOne({ where: { id: STATS_SCHEDULE_ID } });
    if (!row) {
      await this.ensureRow();
      row = await this.repo.findOne({ where: { id: STATS_SCHEDULE_ID } });
    }
    return row;
  }

  async patch(patch: EverStatsSchedulePatch): Promise<void> {
    if (Object.keys(patch).length) {
      // The row must exist for the update to apply
      await this.read();
      await this.repo.update({ id: STATS_SCHEDULE_ID }, patch);
    }
  }

  /** Takes the lease when it is free or expired (or already ours). */
  async acquire(now: number): Promise<boolean> {
    await this.read();
    const result = await this.repo
      .createQueryBuilder()
      .update(EverStatsSchedule)
      .set({ leasedBy: this.holderId, leaseUntil: now + this.leaseMs })
      .where('id = :id', { id: STATS_SCHEDULE_ID })
      .andWhere('(lease_until IS NULL OR lease_until < :now OR leased_by = :me)', { now, me: this.holderId })
      .execute();
    if (result.affected === 1) {
      return true;
    }
    if (result.affected === undefined || result.affected === null) {
      // A driver that does not report the affected rows: read back who holds the lease
      const row = await this.read();
      return row.leasedBy === this.holderId;
    }
    return false;
  }

  /** Gives the lease back, if this process still holds it. */
  async release(): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(EverStatsSchedule)
      .set({ leasedBy: null, leaseUntil: null })
      .where('id = :id', { id: STATS_SCHEDULE_ID })
      .andWhere('leased_by = :me', { me: this.holderId })
      .execute();
  }
}
