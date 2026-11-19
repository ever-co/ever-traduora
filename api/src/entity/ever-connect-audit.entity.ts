import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * One change of the Ever Platform connection: who (a user id, never an e-mail), what and when. No secret, address or
 * user agent. Each row carries the SHA-256 of the previous one, so a row edited or removed between two kept rows shows
 * (the last 500 are kept; the oldest names the hash of a row that was let go). The chain cannot show that the newest
 * rows were removed.
 */
@Entity('ever_connect_audit')
export class EverConnectAudit {
  @PrimaryColumn({ type: 'varchar', length: 36, name: 'id' })
  id: string;

  /** The position of the row in the chain: unique, so two API processes can never append after the same row. */
  @Column({ type: 'int', name: 'seq', unique: true })
  seq: number;

  @Column({ type: 'bigint', name: 'at', transformer: epochMsTransformer })
  at: number;

  /** Such as `instance.connect`, `integration.disable` or `entitlement.refresh`. */
  @Column({ type: 'varchar', length: 48, name: 'action' })
  action: string;

  /** `user:<id>`, `env`, `platform` or `system`. */
  @Column({ type: 'varchar', length: 64, name: 'actor_ref' })
  actorRef: string;

  @Column({ type: 'varchar', length: 255, name: 'detail', nullable: true })
  detail: string | null;

  @Column({ type: 'varchar', length: 64, name: 'prev_hash', nullable: true })
  prevHash: string | null;

  @Column({ type: 'varchar', length: 64, name: 'hash' })
  hash: string;
}
