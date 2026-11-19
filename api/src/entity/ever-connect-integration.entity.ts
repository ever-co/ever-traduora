import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * The state of one installation-wide integration as Ever Platform last reported it (`available`, `pending_operator`,
 * `enabled`, `disabled`, `revoked`, `denied_by_policy` or `coming_soon`). Nothing here turns an integration on: only a
 * consent recorded in app.ever.co does.
 */
@Entity('ever_connect_integration')
export class EverConnectIntegration {
  @PrimaryColumn({ type: 'varchar', length: 48, name: 'integration_key' })
  key: string;

  @Column({ type: 'varchar', length: 24, name: 'state' })
  state: string;

  @Column({ type: 'varchar', length: 64, name: 'consent_id', nullable: true })
  consentId: string | null;

  @Column({ type: 'int', name: 'scope_version', nullable: true })
  scopeVersion: number | null;

  /** Switched off here while Ever Platform could not be told: sent again with the next heartbeat. */
  @Column({ type: 'boolean', name: 'pending_remote_revoke', default: false })
  pendingRemoteRevoke: boolean;

  /** What this installation sent for it, as JSON (the public address for `instance_url`). */
  @Column({ type: 'text', name: 'config', nullable: true })
  config: string | null;

  @Column({ type: 'bigint', name: 'updated_at', transformer: epochMsTransformer })
  updatedAt: number;
}
