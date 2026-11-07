import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { EVER_STATS_LEASE_OWNER, EverStatsLease } from '../entity/ever-stats-lease.entity';

/**
 * The sending lease in the database: when several API processes share one database, the one that takes it sends and
 * the others skip. Taking it is one compare-and-set statement on the `stats` row,
 * `UPDATE ever_stats_lease SET leased_by = :me, lease_until = :until WHERE owner = 'stats' AND (lease_until IS NULL OR
 * lease_until < :now OR leased_by = :me)`, and the affected-row count of the driver says whether it was taken.
 */
export class EverStatsLeaseLock {
  /** This process, as the lease names it (random, nothing else). */
  readonly holderId = randomUUID();

  constructor(
    private readonly repo: Repository<EverStatsLease>,
    private readonly durationMs: number,
  ) {}

  private async compareAndSet(now: number): Promise<boolean> {
    const result = await this.repo
      .createQueryBuilder()
      .update(EverStatsLease)
      .set({ leasedBy: this.holderId, leaseUntil: new Date(now + this.durationMs) })
      .where('owner = :owner', { owner: EVER_STATS_LEASE_OWNER })
      .andWhere('(lease_until IS NULL OR lease_until < :now OR leased_by = :me)', { now: new Date(now), me: this.holderId })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  /** Takes the lease when it is free or expired (or already held by this process). */
  async acquire(now: number): Promise<boolean> {
    if (await this.compareAndSet(now)) {
      return true;
    }
    // The migration seeds the row; should it be missing, it is added (free) and tried once more
    const exists = await this.repo.count({ where: { owner: EVER_STATS_LEASE_OWNER } });
    if (exists) {
      return false;
    }
    await this.repo.createQueryBuilder().insert().into(EverStatsLease).values({ owner: EVER_STATS_LEASE_OWNER, leasedBy: null, leaseUntil: null }).orIgnore().execute();
    return this.compareAndSet(now);
  }

  /**
   * Takes the lease, waiting up to `waitMs` (real time) for another process to give it back: false when it is still
   * held after that.
   */
  async acquireWithin(now: () => number, waitMs: number, pollMs = 250): Promise<boolean> {
    const deadline = Date.now() + waitMs;
    for (;;) {
      if (await this.acquire(now())) {
        return true;
      }
      if (Date.now() >= deadline) {
        return false;
      }
      await new Promise(resolve => setTimeout(resolve, pollMs));
    }
  }

  /** Gives the lease back, if this process still holds it. */
  async release(): Promise<void> {
    await this.repo
      .createQueryBuilder()
      .update(EverStatsLease)
      .set({ leasedBy: null, leaseUntil: null })
      .where('owner = :owner AND leased_by = :me', { owner: EVER_STATS_LEASE_OWNER, me: this.holderId })
      .execute();
  }
}
