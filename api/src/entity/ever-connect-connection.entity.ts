import { Column, Entity, PrimaryColumn } from 'typeorm';
import { epochMsTransformer } from './ever-platform-columns';

/**
 * The connection of this installation to Ever Platform: one row (`id = 'self'`), present once an operator connected. It
 * holds the connection key (its private half encrypted under `TR_SECRET`), the Registry id the platform gave this
 * installation, its one tenant link (the whole installation), the last verified entitlement documents, the event feed
 * position, the schedule of the background calls and their lease.
 */
@Entity('ever_connect_connection')
export class EverConnectConnection {
  @PrimaryColumn({ type: 'varchar', length: 8, name: 'id' })
  id: string;

  /** `active`, `pending_approval`, `revoked` or `disconnected`. */
  @Column({ type: 'varchar', length: 24, name: 'status' })
  status: string;

  /** The Registry id of this installation (the client assertion's `iss` and `sub`); never the statistics id. */
  @Column({ type: 'varchar', length: 64, name: 'registry_instance_id', nullable: true })
  registryInstanceId: string | null;

  /** The key id the platform assigned to the connection key. */
  @Column({ type: 'varchar', length: 64, name: 'kid', nullable: true })
  kid: string | null;

  /** base64url of the raw 32-byte Ed25519 public key (43 characters). */
  @Column({ type: 'varchar', length: 64, name: 'connect_public_key', nullable: true })
  connectPublicKey: string | null;

  /** The connection private key (PKCS#8 DER), encrypted with AES-256-GCM (see `ever-instance/key-wrap.ts`). */
  @Column({ type: 'text', name: 'connect_private_key_enc', nullable: true })
  connectPrivateKeyEnc: string | null;

  @Column({ type: 'bigint', name: 'connected_at', nullable: true, transformer: epochMsTransformer })
  connectedAt: number | null;

  /** The id of the user who connected, or `env:TR_EVER_CONNECT_CODE` (no e-mail). */
  @Column({ type: 'varchar', length: 64, name: 'connected_by', nullable: true })
  connectedBy: string | null;

  /** The Ever Platform organization the installation belongs to. */
  @Column({ type: 'varchar', length: 64, name: 'org_id', nullable: true })
  orgId: string | null;

  /** The tenant link of the installation (one, for the whole installation). */
  @Column({ type: 'varchar', length: 64, name: 'link_id', nullable: true })
  linkId: string | null;

  @Column({ type: 'varchar', length: 24, name: 'link_state', nullable: true })
  linkState: string | null;

  @Column({ type: 'varchar', length: 120, name: 'display_name', nullable: true })
  displayName: string | null;

  /** The last verified entitlement documents, as JSON (the documents exactly as received, with their claims of record). */
  @Column({ type: 'text', name: 'entitlements', nullable: true })
  entitlements: string | null;

  /** Why the last entitlement refresh did not store a document (a code, never a value). */
  @Column({ type: 'varchar', length: 64, name: 'entitlement_error', nullable: true })
  entitlementError: string | null;

  @Column({ type: 'varchar', length: 128, name: 'feed_cursor', nullable: true })
  feedCursor: string | null;

  @Column({ type: 'bigint', name: 'last_heartbeat_at', nullable: true, transformer: epochMsTransformer })
  lastHeartbeatAt: number | null;

  @Column({ type: 'bigint', name: 'next_heartbeat_at', nullable: true, transformer: epochMsTransformer })
  nextHeartbeatAt: number | null;

  @Column({ type: 'bigint', name: 'next_entitlement_at', nullable: true, transformer: epochMsTransformer })
  nextEntitlementAt: number | null;

  /** The random token of the connect attempt holding the row (`connecting`): only that attempt may complete it. */
  @Column({ type: 'varchar', length: 64, name: 'claim_token', nullable: true })
  claimToken: string | null;

  /** SHA-256 of the `TR_EVER_CONNECT_CODE` value already redeemed (or refused): it is never tried twice. */
  @Column({ type: 'varchar', length: 64, name: 'env_code_hash', nullable: true })
  envCodeHash: string | null;

  /** The process holding the lease of the background calls (a random id, nothing else). */
  @Column({ type: 'varchar', length: 64, name: 'leased_by', nullable: true })
  leasedBy: string | null;

  @Column({ type: 'bigint', name: 'lease_until', nullable: true, transformer: epochMsTransformer })
  leaseUntil: number | null;

  @Column({ type: 'bigint', name: 'updated_at', transformer: epochMsTransformer })
  updatedAt: number;
}
