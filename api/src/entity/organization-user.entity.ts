import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Organization } from './organization.entity';
import { User } from './user.entity';
import { OrganizationRole } from '../domain/organization-actions';

/**
 * A person's membership of an organization, with their organization role. Exactly one member of an organization is
 * its `owner` (kept by `OrganizationService`).
 */
@Entity()
@Index(['organization', 'user'], { unique: true })
export class OrganizationUser {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  organization: Organization;

  @Column({ nullable: false })
  organizationId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  user: User;

  @Column({ nullable: false })
  userId: string;

  @Column({ type: 'varchar', length: 16, default: OrganizationRole.Member })
  role: OrganizationRole;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
