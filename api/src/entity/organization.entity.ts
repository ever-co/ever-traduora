import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { OrganizationPlanCode, OrganizationStatus } from '../domain/organization-actions';
import { NumberColumnType } from '../utils/database-type-helper';

/**
 * The tenant: an organization owns projects, and people are its members (`OrganizationUser`). A single-tenant install
 * has exactly one, the default organization (`isDefault`), which the migration made for the existing data.
 */
@Entity()
export class Organization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 40 })
  slug: string;

  @Column({ type: 'varchar', length: 16, default: OrganizationStatus.Active })
  status: OrganizationStatus;

  @Column({ type: 'varchar', length: 32, default: OrganizationPlanCode.Starter })
  planCode: OrganizationPlanCode;

  @Column({ default: false })
  isDefault: boolean;

  /** Cached counters (DESIGN §3.6): members plus pending organization invites. */
  @Column(NumberColumnType.integer(0))
  seatsUsed: number;

  /** Cached counters (DESIGN §3.6): the sum over the projects of locales × terms. */
  @Column(NumberColumnType.integer(0))
  stringsUsed: number;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
