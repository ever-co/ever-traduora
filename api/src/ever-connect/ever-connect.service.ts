import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { CONSTANTS, codes, entitlementStatus, INTEGRATIONS, signCompactJws } from '@ever-co/connect-sdk';
import { createHash, randomInt, randomUUID } from 'crypto';
import { IsNull, Repository } from 'typeorm';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverConnectPersonLink } from '../entity/ever-connect-person-link.entity';
import { EverPlatformException } from '../errors';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EVER_INSTANCE_SETTINGS, EverInstanceSettings } from '../ever-instance/ever-instance.settings';
import { CONNECT_KEY_PURPOSE, EverInstanceKeyError, signBytes, unwrapKey, wrapKey } from '../ever-instance/key-wrap';
import { EverConnectAuditService } from './ever-connect-audit.service';
import {
  EVER_CONNECT_CLIENT_FACTORY,
  EverConnectClientFactory,
  EverConnectPlatformClient,
  generateConnectKey,
  problemOf,
  StoredEntitlement,
} from './ever-connect-platform.client';
import { EVER_CONNECT_SETTINGS, EverConnectSettings } from './ever-connect.settings';

/** The id of the single connection row. */
export const CONNECTION_ID = 'self';

/** The version of this module, sent in the heartbeat. */
export const CONNECT_MODULE_VERSION = '1.0.0';

/** The integrations Traduora offers, in the order the page lists them. */
export const TRADUORA_INTEGRATIONS = ['instance_url', 'stats_link', 'ever_id_login', 'managed_operations'] as const;

/** The status ladder of an entitlement document: valid, then stale within its grace period, then paused. */
export type EntitlementState = 'valid' | 'stale' | 'paused' | 'none';

interface StoredEntitlements {
  instance: StoredEntitlement | null;
  link: StoredEntitlement | null;
}

/** What the operator sees of the connection. Never a key, a token or a document. */
export interface EverConnectStatus {
  connected: boolean;
  status: string;
  registryInstanceId: string | null;
  orgId: string | null;
  linkId: string | null;
  linkState: string | null;
  displayName: string | null;
  connectedAt: number | null;
  lastHeartbeatAt: number | null;
  entitlement: { state: EntitlementState; tier: string | null; expiresAt: number | null; error: string | null };
  installSource: string;
  destinationUsable: boolean;
}

/** An integration as the page shows it: its definition, its state, and what it moves. */
export interface EverConnectIntegrationView {
  key: string;
  name: string;
  description: string;
  state: string;
  consentId: string | null;
  pendingRemoteRevoke: boolean;
  deniedHere: boolean;
  config: Record<string, unknown>;
  scope: ReadonlyArray<Record<string, unknown>>;
}

const conflict = (code: string, message: string) => new EverPlatformException(HttpStatus.CONFLICT, code, message);

const parseJson = <T>(text: string | null, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};

/**
 * The Ever Platform connection of this installation: connect with a code, the background calls (heartbeat, entitlement
 * documents, event feed), the integrations an organization consented to in app.ever.co, and disconnect. Every call goes
 * through the SDK client (one origin, no redirect, signed client assertion). Nothing is called before an operator
 * connects, and nothing after a disconnect or a revocation.
 */
@Injectable()
export class EverConnectService {
  private readonly logger = new Logger(EverConnectService.name);
  private cachedClient: { kid: string; client: EverConnectPlatformClient } | null = null;

  constructor(
    @InjectRepository(EverConnectConnection) private readonly connections: Repository<EverConnectConnection>,
    @InjectRepository(EverConnectIntegration) private readonly integrationRows: Repository<EverConnectIntegration>,
    @Inject(EVER_CONNECT_SETTINGS) private readonly settings: EverConnectSettings,
    @Inject(EVER_INSTANCE_SETTINGS) private readonly instanceSettings: EverInstanceSettings,
    @Inject(EVER_CONNECT_CLIENT_FACTORY) private readonly clientFactory: EverConnectClientFactory,
    private readonly instance: EverInstanceService,
    private readonly audit: EverConnectAuditService,
  ) {}

  /** The connection row, or null before the first connect. */
  read(): Promise<EverConnectConnection | null> {
    return this.connections.findOne({ where: { id: CONNECTION_ID } });
  }

  /** Whether calls may be made: connected, approved or waiting for approval, and not revoked. */
  isLive(connection: EverConnectConnection | null): boolean {
    return !!connection && (connection.status === 'active' || connection.status === 'pending_approval');
  }

  private async save(connection: EverConnectConnection): Promise<EverConnectConnection> {
    connection.updatedAt = Date.now();
    return this.connections.save(connection);
  }

  /** The SDK client of the stored connection key. */
  private client(connection: EverConnectConnection): EverConnectPlatformClient {
    if (!this.settings.apiUrl) {
      throw conflict('no_destination', 'The Ever Platform address of this server cannot be used');
    }
    if (this.cachedClient && this.cachedClient.kid === connection.kid) {
      return this.cachedClient.client;
    }
    const privateKeyDer = unwrapKey(connection.connectPrivateKeyEnc, this.instanceSettings.secret, connection.connectPublicKey, CONNECT_KEY_PURPOSE);
    const client = this.clientFactory({
      baseUrl: this.settings.apiUrl,
      version: this.settings.version,
      issuer: this.settings.issuer,
      rootKeysFile: this.settings.rootKeysFile,
      privateKeyDer,
      registryInstanceId: () => connection.registryInstanceId,
      onWarning: message => this.logger.warn(`ever_connect.sdk ${message}`),
    });
    this.cachedClient = { kid: connection.kid, client };
    return client;
  }

  /** The client of a live connection, or null (nothing is called then). */
  async liveClient(): Promise<{ connection: EverConnectConnection; client: EverConnectPlatformClient } | null> {
    const connection = await this.read();
    if (!this.isLive(connection) || !this.settings.apiUrl) {
      return null;
    }
    return { connection, client: this.client(connection) };
  }

  /** The entitlement state of the installation, from the stored (verified) document only. */
  entitlementState(connection: EverConnectConnection | null, nowS = Math.floor(Date.now() / 1000)): EverConnectStatus['entitlement'] {
    const stored = parseJson<StoredEntitlements>(connection?.entitlements ?? null, { instance: null, link: null });
    // A link document counts only while the link is active
    const doc = (connection?.linkState === 'active' && stored.link) || stored.instance;
    if (!doc) {
      return { state: 'none', tier: null, expiresAt: null, error: connection?.entitlementError ?? null };
    }
    return {
      state: entitlementStatus({ exp: doc.exp, ever: { grace_s: doc.graceS } }, nowS),
      tier: doc.tier,
      expiresAt: doc.exp * 1000,
      error: connection.entitlementError,
    };
  }

  async status(): Promise<EverConnectStatus> {
    const connection = await this.read();
    return {
      connected: this.isLive(connection),
      status: connection ? connection.status : 'not_connected',
      registryInstanceId: connection?.registryInstanceId ?? null,
      orgId: connection?.orgId ?? null,
      linkId: connection?.linkId ?? null,
      linkState: connection?.linkState ?? null,
      displayName: connection?.displayName ?? null,
      connectedAt: connection?.connectedAt ?? null,
      lastHeartbeatAt: connection?.lastHeartbeatAt ?? null,
      entitlement: this.entitlementState(connection),
      installSource: this.settings.installSource,
      destinationUsable: this.settings.apiUrl !== null,
    };
  }

  /**
   * Connects with a connect code an organization owner or admin created in app.ever.co: a new connection key (stored
   * encrypted under `TR_SECRET`), one redeem that also links the whole installation to the organization, then the
   * entitlement documents and the integration states. The redeem carries the product, its version, the declared install
   * source, the public key and the name the operator typed; no address and no data of any user.
   */
  async connect(code: string, displayName: string, actorRef: string): Promise<EverConnectStatus> {
    const normalized = typeof code === 'string' ? codes.normalize(code) : null;
    if (!normalized || !codes.isConnectCode(normalized)) {
      throw new EverPlatformException(HttpStatus.BAD_REQUEST, 'code_invalid', 'This is not a connect code (EVC-XXXX-XXXX-XXXX)');
    }
    if (!this.instanceSettings.secret) {
      throw conflict('secret_missing', 'Set TR_SECRET on the server before connecting: the connection key is stored encrypted with it');
    }
    if (!this.settings.apiUrl) {
      throw conflict('no_destination', 'The Ever Platform address of this server cannot be used');
    }
    const existing = await this.read();
    if (this.isLive(existing)) {
      throw conflict('already_connected', 'This installation is already connected');
    }
    const previousStatus = existing ? existing.status : 'not_connected';
    const claimToken = await this.claim();

    const key = generateConnectKey();
    const connection = (await this.read()) || new EverConnectConnection();
    connection.id = CONNECTION_ID;
    connection.connectPublicKey = key.publicKey;
    connection.connectPrivateKeyEnc = wrapKey(key.privateKeyDer, this.instanceSettings.secret, key.publicKey, CONNECT_KEY_PURPOSE);
    connection.registryInstanceId = null;
    connection.kid = `local:${key.publicKey.slice(0, 16)}`;
    const client = this.clientFactory({
      baseUrl: this.settings.apiUrl,
      version: this.settings.version,
      issuer: this.settings.issuer,
      rootKeysFile: this.settings.rootKeysFile,
      privateKeyDer: key.privateKeyDer,
      registryInstanceId: () => connection.registryInstanceId,
      onWarning: message => this.logger.warn(`ever_connect.sdk ${message}`),
    });

    const name = (displayName || '').trim().slice(0, 120) || 'Traduora';
    let answer;
    try {
      answer = await client.redeem({
        code: normalized,
        version: this.settings.version,
        installSource: this.settings.installSource,
        publicKey: key.publicKey,
        displayName: name,
        idempotencyKey: randomUUID(),
      });
    } catch (error) {
      await this.connections.update({ id: CONNECTION_ID, claimToken }, { status: previousStatus, claimToken: null, updatedAt: Date.now() });
      const problem = problemOf(error);
      this.logger.warn(`ever_connect.connect outcome=refused reason=${problem ? `${problem.status}:${problem.code}` : 'connection_error'}`);
      if (problem && problem.status < 500) {
        throw new EverPlatformException(
          problem.status === 409 ? HttpStatus.CONFLICT : HttpStatus.UNPROCESSABLE_ENTITY,
          problem.code,
          'Ever Platform did not accept this code',
        );
      }
      throw new EverPlatformException(HttpStatus.BAD_GATEWAY, 'platform_unavailable', 'Ever Platform could not be reached; nothing was changed');
    }

    connection.status = answer.status === 'pending_approval' ? 'pending_approval' : 'active';
    connection.registryInstanceId = answer.registryInstanceId;
    connection.kid = answer.kid;
    connection.connectedAt = Date.now();
    connection.connectedBy = actorRef;
    connection.orgId = answer.link ? answer.link.orgId : null;
    connection.linkId = answer.link ? answer.link.id : null;
    connection.linkState = answer.link ? answer.link.state : null;
    connection.displayName = answer.link?.displayName || name;
    connection.entitlements = null;
    connection.entitlementError = null;
    connection.feedCursor = null;
    // The first heartbeat within five minutes, the documents at once
    connection.nextHeartbeatAt = Date.now() + randomInt(5 * 60 * 1000);
    connection.nextEntitlementAt = Date.now();
    // Completed only by the attempt that still holds the claim (one that waited past it never overwrites another)
    const { id, ...fields } = connection;
    const done = await this.connections.update({ id: CONNECTION_ID, claimToken }, { ...fields, claimToken: null, updatedAt: Date.now() });
    if (done.affected === 0) {
      throw conflict('already_connected', 'Another connect completed first');
    }
    this.cachedClient = { kid: connection.kid, client };
    await this.audit.record('instance.connect', actorRef, `status=${connection.status}`);
    if (connection.linkId) {
      await this.audit.record('link.create', actorRef, `link=${connection.linkId}`);
    }
    this.logger.log(`ever_connect.connect outcome=${connection.status}`);

    if (connection.status === 'active') {
      await this.refreshEntitlements('system').catch(() => undefined);
      await this.refreshIntegrations().catch(() => undefined);
    }
    return this.status();
  }

  /**
   * Claims the connection row for one connect at a time, across API processes: the row moves to `connecting` only from
   * a state that is not connected (or from a `connecting` older than a minute, left by a process that stopped).
   */
  private async claim(): Promise<string> {
    const now = Date.now();
    const token = randomUUID();
    await this.connections
      .createQueryBuilder()
      .insert()
      .into(EverConnectConnection)
      .values({ id: CONNECTION_ID, status: 'not_connected', updatedAt: now })
      .orIgnore()
      .execute();
    const result = await this.connections
      .createQueryBuilder()
      .update(EverConnectConnection)
      .set({ status: 'connecting', claimToken: token, updatedAt: now })
      .where('id = :id', { id: CONNECTION_ID })
      .andWhere("(status NOT IN ('active', 'pending_approval', 'connecting') OR (status = 'connecting' AND updated_at < :stale))", {
        stale: now - 60000,
      })
      .execute();
    if (result.affected === 0) {
      throw conflict('already_connected', 'This installation is already connected, or being connected');
    }
    return token;
  }

  /** Redeems `TR_EVER_CONNECT_CODE` once at boot, when nothing is connected and this code was never tried. */
  async connectFromEnv(): Promise<void> {
    const code = this.settings.connectCode;
    if (!code) return;
    const hash = createHash('sha256').update(code).digest('hex');
    const existing = await this.read();
    if (this.isLive(existing) || (existing && existing.envCodeHash === hash)) {
      return;
    }
    try {
      await this.connect(code, 'Traduora', 'env:TR_EVER_CONNECT_CODE');
    } catch (error) {
      const reason = error instanceof EverPlatformException ? error.code : 'error';
      this.logger.warn(`ever_connect.env_code outcome=refused reason=${reason}`);
      // Only a code Ever Platform refused is retired; one never sent (no TR_SECRET, no address, platform out of reach,
      // another connect running) is tried again at the next start
      const refusedByPlatform = error instanceof EverPlatformException && error.getStatus() === 422;
      const malformed = error instanceof EverPlatformException && error.code === 'code_invalid' && error.getStatus() === 400;
      if (!refusedByPlatform && !malformed) {
        return;
      }
    }
    const after = (await this.read()) || Object.assign(new EverConnectConnection(), { id: CONNECTION_ID, status: 'not_connected' });
    after.envCodeHash = hash;
    await this.save(after);
  }

  /**
   * Disconnects: Ever Platform is told first (the installation leaves its organization), then the connection key, the
   * documents and the integration states are forgotten here. The anonymous usage statistics and their key are not
   * touched. When Ever Platform cannot be reached, the connection ends here anyway.
   */
  async disconnect(actorRef: string): Promise<EverConnectStatus> {
    // A connection key that cannot be read any more (TR_SECRET changed) still lets the connection end here
    const live = await this.liveClient().catch((): null => null);
    const connection = live ? live.connection : await this.read();
    if (!connection) {
      throw conflict('not_connected', 'This installation is not connected');
    }
    let remote = 'skipped';
    if (live) {
      try {
        await live.client.disconnect(randomUUID());
        remote = 'done';
      } catch (error) {
        const problem = problemOf(error);
        remote = problem ? `${problem.status}:${problem.code}` : 'unreachable';
      }
    }
    connection.status = 'disconnected';
    connection.connectPrivateKeyEnc = null;
    connection.connectPublicKey = null;
    connection.kid = null;
    connection.entitlements = null;
    connection.entitlementError = null;
    connection.feedCursor = null;
    connection.linkState = connection.linkId ? 'unlinked' : null;
    connection.nextHeartbeatAt = null;
    connection.nextEntitlementAt = null;
    connection.updatedAt = Date.now();
    this.cachedClient = null;
    // The connection, its integration states and its person links end together
    await this.connections.manager.transaction(async manager => {
      await manager.save(connection);
      await manager.createQueryBuilder().delete().from(EverConnectIntegration).execute();
      await manager.createQueryBuilder().delete().from(EverConnectPersonLink).execute();
    });
    await this.audit.record('instance.disconnect', actorRef, `remote=${remote}`);
    this.logger.log(`ever_connect.disconnect remote=${remote}`);
    return this.status();
  }

  /** The platform ended this installation's connection (revoked, or disconnected from app.ever.co). */
  async endedByPlatform(status: 'revoked' | 'disconnected', reason: string, kid?: string | null): Promise<void> {
    const connection = await this.read();
    if (!connection || connection.status === status) return;
    // An answer about an earlier connection key never ends the connection that replaced it
    if (kid !== undefined && kid !== connection.kid) return;
    // Ever Platform ended the person links and the consents with the connection (a later connection reads them again).
    // Only the connection read above ends: the update matches its key and state, so a disconnect and a new connect
    // made meanwhile by another API process are never overwritten, and its rows are deleted only after that update
    const ended = await this.connections.manager.transaction(async manager => {
      const { affected } = await manager.update(
        EverConnectConnection,
        { id: CONNECTION_ID, kid: connection.kid === null ? IsNull() : connection.kid, status: connection.status },
        { status, nextHeartbeatAt: null, nextEntitlementAt: null, updatedAt: Date.now() },
      );
      if (!affected) return false;
      await manager.createQueryBuilder().delete().from(EverConnectIntegration).execute();
      await manager.createQueryBuilder().delete().from(EverConnectPersonLink).execute();
      return true;
    });
    if (!ended) return;
    this.cachedClient = null;
    await this.audit.record(`instance.${status}`, 'platform', reason);
    this.logger.warn(`ever_connect.connection state=${status} reason=${reason}`);
  }

  /** What to do with an error of a call: a revoked credential ends the connection; anything else is reported as a code. */
  async handleCallError(error: unknown, call: string, kid?: string | null): Promise<string> {
    if (error instanceof EverInstanceKeyError) {
      return `key_${error.code}`;
    }
    const problem = problemOf(error);
    if (problem && problem.status === 401 && problem.code === 'credential_revoked') {
      await this.endedByPlatform('revoked', `${call}:credential_revoked`, kid);
    }
    const reason = problem ? `${problem.status}:${problem.code}` : 'unreachable';
    this.logger.warn(`ever_connect.${call} outcome=failed reason=${reason}`);
    return reason;
  }

  /** One heartbeat: the version, the module version and the integrations denied here. Also resends a pending revoke. */
  async heartbeat(): Promise<void> {
    const live = await this.liveClient();
    // While waiting for approval, Ever Platform answers only the installation's own state (see refreshSelf)
    if (!live || live.connection.status !== 'active') return;
    try {
      await live.client.heartbeat({
        version: this.settings.version,
        moduleVersion: CONNECT_MODULE_VERSION,
        integrationsDenied: [...this.settings.integrationsDeny],
      });
      // Only this field, and only while the same connection is still there (a disconnect may have happened meanwhile)
      await this.connections.update({ id: CONNECTION_ID, kid: live.connection.kid }, { lastHeartbeatAt: Date.now(), updatedAt: Date.now() });
      await this.flushPendingRevokes(live.client);
    } catch (error) {
      await this.handleCallError(error, 'heartbeat', live.connection.kid);
    }
  }

  /**
   * Fetches and verifies the entitlement documents (the installation's and its link's). A document is stored only once
   * the SDK verified it (signature, issuer, audience, this installation, sequence); otherwise the previous one stays.
   */
  async refreshEntitlements(actorRef = 'system', strict = false): Promise<EverConnectStatus['entitlement']> {
    const live = await this.liveClient();
    if (!live) {
      throw conflict('not_connected', 'This installation is not connected');
    }
    const { connection, client } = live;
    const stored = parseJson<StoredEntitlements>(connection.entitlements, { instance: null, link: null });
    let error: string | null = null;
    try {
      const instanceDoc = await client.entitlement(null, stored.instance);
      if (instanceDoc) stored.instance = instanceDoc;
      if (connection.linkId && connection.linkState !== 'unlinked') {
        const linkDoc = await client.entitlement(connection.linkId, stored.link);
        if (linkDoc) stored.link = linkDoc;
      }
    } catch (caught) {
      error = await this.handleCallError(caught, 'entitlement', connection.kid);
    }
    // Another refresh may have stored a newer document meanwhile: per subject, the higher sequence wins
    const latest = await this.read();
    if (latest && latest.kid === connection.kid) {
      const theirs = parseJson<StoredEntitlements>(latest.entitlements, { instance: null, link: null });
      for (const subject of ['instance', 'link'] as const) {
        if (theirs[subject] && (!stored[subject] || theirs[subject].seq > stored[subject].seq)) {
          stored[subject] = theirs[subject];
        }
      }
    }
    await this.connections.update(
      { id: CONNECTION_ID, kid: connection.kid },
      { entitlements: JSON.stringify(stored), entitlementError: error ? error.slice(0, 64) : null, updatedAt: Date.now() },
    );
    if (actorRef !== 'system') {
      await this.audit.record('entitlement.refresh', actorRef, error ? `error=${error}` : null);
    }
    // For the event feed: a failed refresh must keep its page unacknowledged
    if (strict && error) {
      throw new Error(`entitlement refresh failed: ${error}`);
    }
    return this.entitlementState(await this.read());
  }

  /**
   * Reads the installation's own state and its link again: while waiting for approval (every minute), and after a feed
   * event about the link. An approval starts the documents and the integrations; a removed link drops its document.
   */
  async refreshSelf(): Promise<void> {
    const live = await this.liveClient();
    if (!live) return;
    const { connection, client } = live;
    const self = await client.self();
    if (self.status === 'revoked' || self.status === 'disconnected') {
      // An answer read for a connection that was replaced meanwhile never ends the new one
      await this.endedByPlatform(self.status, 'state', connection.kid);
      return;
    }
    const status = self.status === 'active' || self.status === 'pending_approval' ? self.status : connection.status;
    const linkId = self.link ? self.link.id : connection.linkId;
    const linkState = self.link ? self.link.state : connection.linkId ? 'unlinked' : null;
    const patch: Partial<EverConnectConnection> = { status, linkId, linkState, updatedAt: Date.now() };
    if (linkState !== 'active' || linkId !== connection.linkId) {
      // The link ended or changed: its document goes, the installation's (as stored now) stays
      const latest = await this.read();
      const stored = parseJson<StoredEntitlements>(latest ? latest.entitlements : null, { instance: null, link: null });
      if (stored.link) {
        stored.link = null;
        patch.entitlements = JSON.stringify(stored);
      }
    }
    await this.connections.update({ id: CONNECTION_ID, kid: connection.kid }, patch);
    if (connection.linkState !== linkState) {
      await this.audit.record('link.state', 'platform', `state=${linkState}`);
    }
    if (connection.status === 'pending_approval' && status === 'active') {
      await this.audit.record('instance.approved', 'platform', null);
      await this.refreshEntitlements('system').catch(() => undefined);
      await this.refreshIntegrations().catch(() => undefined);
    }
  }

  /** Reads the integration states from Ever Platform and stores them; reports each change once. */
  async refreshIntegrations(): Promise<EverConnectIntegrationView[]> {
    const live = await this.liveClient();
    if (!live) {
      return this.integrations();
    }
    const states = await live.client.integrations();
    // A disconnect (or another connection) while the states were read: they belong to a connection that has ended
    const current = await this.read();
    if (!current || current.kid !== live.connection.kid || !this.isLive(current)) {
      return this.integrations();
    }
    for (const key of TRADUORA_INTEGRATIONS) {
      const remote = states[key];
      const row =
        (await this.integrationRows.findOne({ where: { key } })) || Object.assign(new EverConnectIntegration(), { key, pendingRemoteRevoke: false });
      const before = row.state;
      const remoteState = remote ? remote.state : INTEGRATIONS[key].status === 'coming_soon' ? 'coming_soon' : 'available';
      // Switched off here while Ever Platform could not be told: it stays off here until the revoke is delivered
      const keptOff = row.pendingRemoteRevoke && (remoteState === 'enabled' || remoteState === 'pending_operator');
      if (!keptOff) {
        row.state = remoteState;
        row.consentId = remote ? remote.consentId : null;
        row.scopeVersion = remote ? remote.scopeVersion : null;
        row.pendingRemoteRevoke = false;
      }
      row.updatedAt = Date.now();
      if (key === 'instance_url' && before === 'enabled' && row.state !== 'enabled') {
        row.config = null;
      }
      if (key === 'stats_link' && row.state !== 'enabled') {
        row.config = null;
      }
      await this.integrationRows.save(row);
      // A first reading that finds nothing on is not a change
      if (before !== row.state && (before !== undefined || (row.state !== 'available' && row.state !== 'coming_soon'))) {
        await this.audit.record('integration.state', 'platform', `${key}=${row.state}`);
      }
      if (key === 'stats_link') {
        await this.syncStatsLink(live.connection.kid);
      }
    }
    return this.integrations();
  }

  /**
   * Sends the statistics link while the `stats_link` integration is enabled and the current statistics identity is not
   * the one linked: never sent, a failed send, or an identity the operator reset since. Two reads when nothing changed;
   * run after each integration refresh and by the scheduler, so a reset identity is linked without waiting for an event.
   */
  async syncStatsLink(kid: string | null): Promise<void> {
    const row = await this.integrationRows.findOne({ where: { key: 'stats_link' } });
    if (!row || row.state !== 'enabled') return;
    const identity = await this.instance.read();
    const linked = parseJson<{ linked?: boolean; statsInstanceId?: string }>(row.config, {});
    if (linked.linked && identity && linked.statsInstanceId === identity.instanceId) return;
    const sent = await this.linkStats('platform').catch(error => this.handleCallError(error, 'stats_link', kid).then(() => false as const));
    if (sent) {
      row.config = JSON.stringify({ linked: true, statsInstanceId: sent });
      await this.integrationRows.save(row);
    }
  }

  /** The integrations of Traduora with their definitions, states and scopes (what each one moves). */
  async integrations(): Promise<EverConnectIntegrationView[]> {
    const rows = await this.integrationRows.find();
    return TRADUORA_INTEGRATIONS.map(key => {
      const definition = INTEGRATIONS[key];
      const row = rows.find(candidate => candidate.key === key);
      const deniedHere = this.settings.integrationsDeny.includes(key);
      return {
        key,
        name: definition.name,
        description: definition.description,
        state: deniedHere
          ? 'denied_by_policy'
          : definition.status === 'coming_soon' && (!row || row.state === 'available')
            ? 'coming_soon'
            : row
              ? row.state
              : 'available',
        consentId: row ? row.consentId : null,
        pendingRemoteRevoke: row ? row.pendingRemoteRevoke : false,
        deniedHere,
        config: parseJson<Record<string, unknown>>(row ? row.config : null, {}),
        scope: (definition.scope || []).map(entry => ({ ...entry })),
      };
    });
  }

  private knownIntegration(key: string): void {
    if (!(TRADUORA_INTEGRATIONS as ReadonlyArray<string>).includes(key)) {
      throw new EverPlatformException(HttpStatus.NOT_FOUND, 'unknown_integration', 'Traduora does not offer this integration');
    }
  }

  /** The app.ever.co address where an organization owner or admin consents to `key` (nothing is enabled here). */
  async consentUrl(key: string): Promise<string> {
    this.knownIntegration(key);
    if (this.settings.integrationsDeny.includes(key)) {
      throw conflict('denied_by_policy', 'This integration is denied on this installation (TR_EVER_CONNECT_INTEGRATIONS_DENY)');
    }
    const live = await this.liveClient();
    if (!live) {
      throw conflict('not_connected', 'This installation is not connected');
    }
    try {
      return await live.client.consentUrl(key);
    } catch (error) {
      throw conflict(await this.handleCallError(error, 'consent_url', live.connection.kid), 'Ever Platform did not give a consent link');
    }
  }

  /** The operator accepts (or declines) an installation-wide integration an organization consented to. */
  async acceptIntegration(key: string, accepted: boolean, actorRef: string): Promise<EverConnectIntegrationView[]> {
    this.knownIntegration(key);
    const live = await this.liveClient();
    if (!live) {
      throw conflict('not_connected', 'This installation is not connected');
    }
    const row = await this.integrationRows.findOne({ where: { key } });
    if (!row || row.state !== 'pending_operator' || !row.consentId) {
      throw conflict('nothing_to_accept', 'This integration does not wait for the operator');
    }
    if (accepted && this.settings.integrationsDeny.includes(key)) {
      throw conflict('denied_by_policy', 'This integration is denied on this installation (TR_EVER_CONNECT_INTEGRATIONS_DENY)');
    }
    try {
      await live.client.acceptIntegration(key, row.consentId, accepted, randomUUID());
    } catch (error) {
      throw conflict(await this.handleCallError(error, 'integration_accept', live.connection.kid), 'Ever Platform did not record the answer');
    }
    await this.audit.record(accepted ? 'integration.accept' : 'integration.decline', actorRef, key);
    return this.refreshIntegrations();
  }

  /**
   * Switches an integration off. Ever Platform is told first; when it cannot be reached, the integration is off here at
   * once and the revoke is sent again with the next heartbeat.
   */
  async disableIntegration(key: string, actorRef: string): Promise<EverConnectIntegrationView[]> {
    this.knownIntegration(key);
    const live = await this.liveClient();
    if (!live) {
      throw conflict('not_connected', 'This installation is not connected');
    }
    const row =
      (await this.integrationRows.findOne({ where: { key } })) ||
      Object.assign(new EverConnectIntegration(), { key, consentId: null, scopeVersion: null });
    let remote = 'done';
    try {
      await live.client.disableIntegration(key, 'instance');
      row.pendingRemoteRevoke = false;
    } catch (error) {
      const problem = problemOf(error);
      if (problem && problem.status === 404) {
        // Nothing was on at Ever Platform
        row.pendingRemoteRevoke = false;
      } else {
        remote = await this.handleCallError(error, 'integration_disable', live.connection.kid);
        row.pendingRemoteRevoke = true;
      }
    }
    row.state = 'disabled';
    row.updatedAt = Date.now();
    if (key === 'instance_url') {
      row.config = null;
    }
    await this.integrationRows.save(row);
    await this.audit.record('integration.disable', actorRef, `${key} remote=${remote}`);
    return this.integrations();
  }

  /** Sends the revokes that could not be sent when the operator switched an integration off. */
  private async flushPendingRevokes(client: EverConnectPlatformClient): Promise<void> {
    const pending = await this.integrationRows.find({ where: { pendingRemoteRevoke: true } });
    for (const row of pending) {
      try {
        await client.disableIntegration(row.key, 'instance');
      } catch (error) {
        const problem = problemOf(error);
        // Not found: an earlier attempt took effect, its answer was lost
        if (!problem || problem.status !== 404) {
          await this.handleCallError(error, 'integration_disable');
          continue;
        }
      }
      row.pendingRemoteRevoke = false;
      row.updatedAt = Date.now();
      await this.integrationRows.save(row);
      await this.audit.record('integration.revoke_sent', 'system', row.key);
    }
  }

  /**
   * Tells Ever Platform the public address of this installation, once an organization consented to `instance_url` in
   * app.ever.co (never at connect, and never otherwise).
   */
  async setPublicUrl(url: string, actorRef: string): Promise<EverConnectIntegrationView[]> {
    let parsed: URL;
    try {
      parsed = new URL(String(url || '').trim());
    } catch {
      throw new EverPlatformException(HttpStatus.BAD_REQUEST, 'url_invalid', 'An absolute https address');
    }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.href.length > 2048) {
      throw new EverPlatformException(HttpStatus.BAD_REQUEST, 'url_invalid', 'An absolute https address without credentials, query or fragment');
    }
    if (this.settings.integrationsDeny.includes('instance_url')) {
      throw conflict('denied_by_policy', 'This integration is denied on this installation (TR_EVER_CONNECT_INTEGRATIONS_DENY)');
    }
    const row = await this.integrationRows.findOne({ where: { key: 'instance_url' } });
    if (!row || row.state !== 'enabled') {
      throw conflict('consent_required', 'An organization owner or admin must first enable the installation address in app.ever.co');
    }
    const live = await this.liveClient();
    if (!live) {
      throw conflict('not_connected', 'This installation is not connected');
    }
    try {
      await live.client.putPublicUrl(parsed.href, randomUUID());
    } catch (error) {
      throw conflict(await this.handleCallError(error, 'public_url', live.connection.kid), 'Ever Platform did not record the address');
    }
    row.config = JSON.stringify({ base_url: parsed.href });
    row.updatedAt = Date.now();
    await this.integrationRows.save(row);
    await this.audit.record('instance_url.set', actorRef, null);
    return this.integrations();
  }

  /** Removes the public address from Ever Platform. */
  async clearPublicUrl(actorRef: string): Promise<EverConnectIntegrationView[]> {
    const live = await this.liveClient();
    if (!live) {
      throw conflict('not_connected', 'This installation is not connected');
    }
    try {
      await live.client.deletePublicUrl();
    } catch (error) {
      const problem = problemOf(error);
      if (!problem || problem.status !== 404) {
        throw conflict(await this.handleCallError(error, 'public_url', live.connection.kid), 'Ever Platform did not remove the address');
      }
    }
    const row = await this.integrationRows.findOne({ where: { key: 'instance_url' } });
    if (row) {
      row.config = null;
      row.updatedAt = Date.now();
      await this.integrationRows.save(row);
    }
    await this.audit.record('instance_url.clear', actorRef, null);
    return this.integrations();
  }

  /**
   * `stats_link`: links the anonymous statistics of this installation to its organization, with a statement signed by
   * the statistics key (the connection key never signs it). Only when the statistics are loaded.
   */
  /** Sends the statistics link. Returns the statistics instance id it linked, or `false` when nothing was sent. */
  async linkStats(actorRef: string): Promise<string | false> {
    if (!this.settings.statsLoaded || this.settings.integrationsDeny.includes('stats_link')) {
      return false;
    }
    // Not while the operator switched the statistics off on the Statistics page
    if (!(await this.instance.isStatsEnabledUi())) {
      return false;
    }
    const live = await this.liveClient();
    if (!live || !live.connection.registryInstanceId) return false;
    const { record, privateKeyDer } = await this.instance.signingIdentity();
    const statsPublicJwk = { kty: 'OKP', crv: 'Ed25519', x: record.statsPublicKey };
    const statement = await signCompactJws(
      (bytes: Uint8Array) => signBytes(privateKeyDer, bytes),
      { typ: CONSTANTS.stats_link_typ },
      {
        stats_instance_id: record.instanceId,
        stats_public_jwk: statsPublicJwk,
        sub: live.connection.registryInstanceId,
        iat: Math.floor(Date.now() / 1000),
      },
    );
    await live.client.statsLink({ statement, statsInstanceId: record.instanceId, statsPublicKey: record.statsPublicKey }, randomUUID());
    await this.audit.record('stats_link.sent', actorRef, null);
    return record.instanceId;
  }
}
