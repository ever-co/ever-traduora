import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * A person's deletion or export request received from Ever Platform, and this installation's answer (the receipt). It
 * holds the request id and the answer only: never an e-mail, a name or an Ever ID. The answer is decided once and kept,
 * so a request read again is answered the same way. Kept 90 days.
 */
@Entity('ever_connect_person_request')
export class EverConnectPersonRequest {
  /** The request id Ever Platform gave (`job_id`). */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'job_id' })
  jobId: string;

  /** `deletion` or `export`. */
  @Column({ type: 'varchar', length: 16, name: 'kind' })
  kind: string;

  /** The answer: `anonymised`, `exported` or `no_account`; `null` until it is decided. */
  @Column({ type: 'varchar', length: 24, name: 'result', nullable: true })
  result: string | null;

  /** A machine reason code sent with the answer (`identity_unlinked`), or `null`. */
  @Column({ type: 'varchar', length: 64, name: 'reason_code', nullable: true })
  reasonCode: string | null;

  /** How many accounts of this installation the request matched. */
  @Column({ type: 'int', name: 'accounts', default: 0 })
  accounts: number;

  @Column({ type: 'bigint', name: 'received_at', transformer: epochMsTransformer })
  receivedAt: number;

  /** When Ever Platform recorded the answer; `null` while it is still to be sent. */
  @Column({ type: 'bigint', name: 'answered_at', nullable: true, transformer: epochMsTransformer })
  answeredAt: number | null;
}
