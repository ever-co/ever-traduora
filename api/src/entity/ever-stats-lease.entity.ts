import { Column, Entity, PrimaryColumn } from 'typeorm';
import { TimeColumnType } from '../utils/database-type-helper';

/** The owner of the anonymous usage statistics lease row (seeded by the migration). */
export const EVER_STATS_LEASE_OWNER = 'stats';

/**
 * Which API process may send now, and until when. When several API processes share one database, the one that takes
 * the lease (a compare-and-set on this row) sends; the others skip.
 */
@Entity('ever_stats_lease')
export class EverStatsLease {
  @PrimaryColumn({ name: 'owner', type: 'varchar', length: 16 })
  owner: string;

  // A random id of the holding process (nothing else)
  @Column({ name: 'leased_by', type: 'varchar', length: 128, nullable: true })
  leasedBy: string | null;

  @Column({ name: 'lease_until', ...TimeColumnType.date() })
  leaseUntil: Date | null;
}
