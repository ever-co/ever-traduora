import { Column, Entity, PrimaryColumn } from 'typeorm';
import { bigintNumberTransformer, epochMsTransformer } from './ever-platform-columns';

/**
 * One maintenance operation requested from app.ever.co and what became of it: its kind, status and size only (never a
 * path or a file name). A request waiting for its start time keeps its request until it runs. The last 50 are kept.
 */
@Entity('ever_connect_managed_operation')
export class EverConnectManagedOperation {
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'operation_id' })
  operationId: string;

  @Column({ type: 'varchar', length: 24, name: 'kind' })
  kind: string;

  /** `succeeded`, `failed`, `refused` or `deferred` (waiting for its start time). */
  @Column({ type: 'varchar', length: 16, name: 'status' })
  status: string;

  /** Why it was refused or failed: a code (`no_operator_opt_in`, `outside_window`, ...). */
  @Column({ type: 'varchar', length: 48, name: 'reason', nullable: true })
  reason: string | null;

  @Column({ type: 'bigint', name: 'size_bytes', nullable: true, transformer: bigintNumberTransformer })
  sizeBytes: number | null;

  /** The request of a deferred operation, as received (ids, kind and times only). */
  @Column({ type: 'text', name: 'request', nullable: true })
  request: string | null;

  /** A result Ever Platform has not received yet (status, version and size only), sent again until it is. */
  @Column({ type: 'text', name: 'unsent_result', nullable: true })
  unsentResult: string | null;

  /** The connection key (`kid`) of the connection that received the request: work of an ended connection never runs. */
  @Column({ type: 'varchar', length: 64, name: 'connection_kid', nullable: true })
  connectionKid: string | null;

  /** When it may run, for a deferred operation. */
  @Column({ type: 'bigint', name: 'not_before', nullable: true, transformer: epochMsTransformer })
  notBefore: number | null;

  @Column({ type: 'bigint', name: 'at', transformer: epochMsTransformer })
  at: number;
}
