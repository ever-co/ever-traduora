import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * One provisioning intent from app.ever.co that a person answered here (hand-off): created (the project made for the
 * person) or refused. Keyed by the intent's `jti`, so an intent is answered once and a replay finds its answer. Holds
 * ids only: never an e-mail, a name of a person, an Ever ID or the intent itself.
 */
@Entity('ever_connect_provision')
export class EverConnectProvision {
  /** The intent id (`jti`). */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'jti' })
  jti: string;

  /** `created` or `refused`. */
  @Column({ type: 'varchar', length: 16, name: 'state' })
  state: string;

  /** The Traduora user who confirmed (`null` for a refusal). */
  @Column({ type: 'varchar', length: 64, name: 'user_id', nullable: true })
  userId: string | null;

  /** The project created for the organization (`null` for a refusal). */
  @Column({ type: 'varchar', length: 64, name: 'project_id', nullable: true })
  projectId: string | null;

  /** The Registry id of the installation the intent was verified for: its answer is sent under that connection only. */
  @Column({ type: 'varchar', length: 64, name: 'instance_id', nullable: true })
  instanceId: string | null;

  /** Whether the audit trail has the answer (written again by the background round when it could not be at once). */
  @Column({ type: 'boolean', name: 'audited', default: false })
  audited: boolean;

  /** When a caller took the writing of the audit row; a claim older than 5 minutes (an interrupted one) is taken again. */
  @Column({ type: 'bigint', name: 'audit_claimed_at', nullable: true, transformer: epochMsTransformer })
  auditClaimedAt: number | null;

  /** The Ever Platform organization id the intent named. */
  @Column({ type: 'varchar', length: 64, name: 'org_id', nullable: true })
  orgId: string | null;

  /** The tenant link Ever Platform answered to the completion, once it did. */
  @Column({ type: 'varchar', length: 64, name: 'tenant_link_id', nullable: true })
  tenantLinkId: string | null;

  /** Whether Ever Platform has not been told yet (sent again until it is). */
  @Column({ type: 'boolean', name: 'pending_complete', default: false })
  pendingComplete: boolean;

  /** Why Ever Platform refused the completion for good (`404:not_found`, ...), when it did. */
  @Column({ type: 'varchar', length: 48, name: 'complete_refused', nullable: true })
  completeRefused: string | null;

  @Column({ type: 'bigint', name: 'at', transformer: epochMsTransformer })
  at: number;
}
