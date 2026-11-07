import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { TimeColumnType } from '../utils/database-type-helper';
import { User } from './user.entity';

/** How a sign-in identity was attached to an account. */
export enum IdentityLinkMethod {
  // From the account's settings, after a fresh sign-in at the provider
  Explicit = 'explicit',
  // When the account was created with the provider, after the sign-up confirmation screen
  Jit = 'jit',
  // Reserved for accounts created on the person's behalf by the Ever Platform
  Provisioned = 'provisioned',
}

/**
 * A sign-in identity of an OpenID Connect provider (e.g. Ever ID) attached to an account. The account is found by the
 * issuer and subject only: an email never selects an account. No token of the provider is stored.
 */
@Entity('user_identity')
@Index('IDX_user_identity_issuer_subject', ['issuer', 'subject'], { unique: true })
export class UserIdentity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('IDX_user_identity_user_id')
  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: false })
  user: User;

  // The provider slug, e.g. 'everid'
  @Column({ type: 'varchar', length: 32 })
  provider: string;

  @Column({ type: 'varchar', length: 255 })
  issuer: string;

  @Column({ type: 'varchar', length: 255 })
  subject: string;

  // The Ever Platform person id when the issuer sends one: stored alongside, never used to find an account
  @Column({ type: 'varchar', length: 64, nullable: true })
  everPersonId: string | null;

  // The provider's email when the identity was attached (shown in settings; never used to find an account)
  @Column({ type: 'varchar', length: 255 })
  emailAtLink: string;

  @Column({ type: 'varchar', length: 16 })
  linkMethod: IdentityLinkMethod;

  @Column(TimeColumnType.createDate())
  linkedAt: Date;

  @Column({ ...TimeColumnType.date(), nullable: true })
  lastLoginAt: Date | null;
}
