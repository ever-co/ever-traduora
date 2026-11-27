import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { InviteStatus } from './invite.entity';
import { Organization } from './organization.entity';
import { OrganizationRole } from '../domain/organization-actions';

/**
 * An invitation to join an organization, sent to an email. Accepted with the token of its link (only its SHA-256 hash
 * is stored), by the account that has that email.
 */
@Entity()
@Index(['organization', 'email'], { unique: true })
export class OrganizationInvite {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  organization: Organization;

  @Column({ nullable: false })
  organizationId: string;

  @Column({ type: 'varchar', length: 255 })
  email: string;

  /** `admin` or `member`: ownership is only ever transferred. */
  @Column({ type: 'varchar', length: 16, default: OrganizationRole.Member })
  role: OrganizationRole;

  @Column({ type: 'varchar', length: 16, default: InviteStatus.Sent })
  status: InviteStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tokenHash: string | null;

  /** Who sent it (kept when that account is deleted, as a plain id). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  invitedByUserId: string | null;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
