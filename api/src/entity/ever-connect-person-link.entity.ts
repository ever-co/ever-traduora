import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * A person link this installation told Ever Platform about: an Ever ID that a Traduora user signed in with (and so
 * linked to the account themselves), reported so that the person's deletion and export requests reach this
 * installation. Only ids: the Traduora user id and the local identity row. A row whose identity no longer exists is a
 * removal still to be told; it goes once Ever Platform has it.
 */
@Entity('ever_connect_person_link')
export class EverConnectPersonLink {
  /** The `user_identity` row this link reports. */
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'user_identity_id' })
  userIdentityId: string;

  /** The Traduora user the identity belongs to (`product_user_ref`). */
  @Column({ type: 'varchar', length: 36, name: 'user_id' })
  userId: string;

  /** When Ever Platform recorded the link; `null` while it is still to be reported. */
  @Column({ type: 'bigint', name: 'reported_at', nullable: true, transformer: epochMsTransformer })
  reportedAt: number | null;

  @Column({ type: 'bigint', name: 'updated_at', transformer: epochMsTransformer })
  updatedAt: number;
}
