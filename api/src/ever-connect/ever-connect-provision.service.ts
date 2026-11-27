import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, LessThan, Repository } from 'typeorm';
import { config } from '../config';
import { EverConnectAudit } from '../entity/ever-connect-audit.entity';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverConnectProvision } from '../entity/ever-connect-provision.entity';
import { Plan } from '../entity/plan.entity';
import { ProjectUser, ProjectRole } from '../entity/project-user.entity';
import { Project } from '../entity/project.entity';
import { UserIdentity } from '../entity/user-identity.entity';
import { User } from '../entity/user.entity';
import { EverPlatformException } from '../errors';
import { homeOrganizationId } from '../services/organization/organization-membership';
import { Organization } from '../entity/organization.entity';
import { OrganizationStatus } from '../domain/organization-actions';
import { EVER_INSTANCE_SETTINGS, EverInstanceSettings } from '../ever-instance/ever-instance.settings';
import { EverInstanceKeyError, KeyPurpose, unwrapKey, verifyBytes, wrapKey } from '../ever-instance/key-wrap';
import { isLocalHost } from '../ever-platform/env';
import { EverConnectAuditService } from './ever-connect-audit.service';
import { EverConnectPlatformClient, ProvisionComplete, problemOf } from './ever-connect-platform.client';
import { EVER_CONNECT_SETTINGS, EverConnectSettings } from './ever-connect.settings';
import { PROVISION_TXN_MAX } from './ever-connect.dto';
import { EverConnectService } from './ever-connect.service';

/** The header `typ` of a provisioning intent. */
export const INTENT_HEADER_TYP = 'ever-intent+jwt';
/** The claim `typ` of a provisioning intent. */
export const INTENT_CLAIMS_TYP = 'ever.provision_intent.v1';
/** The audience of an intent for Traduora. */
export const INTENT_AUDIENCE = 'ever-connect:traduora';
/** The longest an intent lives (seconds). */
export const INTENT_MAX_TTL_S = 900;
/** Clock skew tolerated on `iat` (seconds). */
export const INTENT_SKEW_S = 300;
/** The longest intent accepted (bytes): far more than a real one. */
const INTENT_MAX_LENGTH = 16384;
/** The longest project name made from an organization's name (also what the confirmation shows). */
const PROJECT_NAME_MAX = 120;
/** The longest address to send the person back to, once normalized. */
const RETURN_ADDRESS_MAX = 2048;
/** The longest Ever ID subject, organization id and handle an intent may carry. */
const SUBJECT_MAX = 255;
const ID_MAX = 64;
/** A claim to write an audit row older than this was interrupted (the process stopped): it is taken again. */
const AUDIT_CLAIM_STALE_MS = 5 * 60 * 1000;

/** The sealed confirmation is encrypted for its own purpose, salted with the Registry id of the installation. */
const PROVISION_TXN_PURPOSE: KeyPurpose = { info: 'ever-connect/provision-txn', aad: 'ever_connect:provision_txn' };

const JTI = /^[A-Za-z0-9_-]{1,64}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;

/** The claims of `ever.provision_intent.v1` this installation reads (it carries no e-mail address). */
export interface IntentClaims {
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  typ: string;
  ever_purpose: string;
  product: string;
  mode: string;
  org: { id: string; handle: string; display_name: string };
  person: { ever_id_sub: string };
  instance_id?: string;
  return_to?: string;
}

/** What the sealed `provisionTxn` carries: ids, the organization's handle and name, and when it expires. */
export interface ProvisionTxn {
  jti: string;
  sub: string;
  org: { id: string; handle: string; displayName: string };
  returnTo: string | null;
  /** Unix seconds. */
  exp: number;
}

const refuse = (status: HttpStatus, code: string, message: string) => new EverPlatformException(status, code, message);
const notAnIntent = () => refuse(HttpStatus.BAD_REQUEST, 'invalid_intent', 'This is not a provisioning intent');
const doesNotVerify = () => refuse(HttpStatus.UNAUTHORIZED, 'invalid_intent', 'The intent does not verify');
const expired = () => refuse(HttpStatus.CONFLICT, 'intent_expired', 'This link has expired: start again from app.ever.co');
const consumed = () => refuse(HttpStatus.CONFLICT, 'intent_consumed', 'This link was already used');
const invalidTxn = () => refuse(HttpStatus.BAD_REQUEST, 'invalid_txn', 'This confirmation is not valid');

function decodePart(part: string): any {
  if (!B64URL.test(part)) throw new Error('malformed');
  const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('malformed');
  return value;
}

/** Seals a confirmation for one installation (its Registry id is the salt): AES-256-GCM with a key derived from TR_SECRET. */
export function sealTxn(txn: ProvisionTxn, secret: string, registryInstanceId: string): string {
  return wrapKey(Buffer.from(JSON.stringify(txn), 'utf8'), secret, registryInstanceId, PROVISION_TXN_PURPOSE);
}

/** An address to send the person back to: an absolute https address (http on a local host only), without credentials. */
export function returnAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname));
    const address = url.toString();
    return secure && !url.username && !url.password && address.length <= RETURN_ADDRESS_MAX ? address : null;
  } catch {
    return null;
  }
}

/** Whether the claims of an intent have the shape `ever.provision_intent.v1` gives them, within this module's bounds. */
function wellFormed(claims: IntentClaims): boolean {
  const org = claims.org;
  const sub = claims.person?.ever_id_sub;
  return (
    claims.typ === INTENT_CLAIMS_TYP &&
    claims.ever_purpose === 'intent' &&
    claims.mode === 'handoff' &&
    typeof claims.jti === 'string' &&
    JTI.test(claims.jti) &&
    typeof sub === 'string' &&
    sub.length > 0 &&
    sub.length <= SUBJECT_MAX &&
    typeof org?.id === 'string' &&
    org.id.length <= ID_MAX &&
    typeof org.handle === 'string' &&
    org.handle.length <= ID_MAX &&
    typeof org.display_name === 'string' &&
    org.display_name.trim().length > 0 &&
    Number.isInteger(claims.iat) &&
    Number.isInteger(claims.exp)
  );
}

/** The Ever ID issuer this installation signs in with, without its trailing slashes; null when none is set. */
export function everIdIssuer(): string | null {
  const issuer = config.providers.everid.issuer;
  return typeof issuer === 'string' && issuer.trim() ? trimSlashes(issuer.trim()) : null;
}

/** An issuer without its trailing slashes (no regular expression: a long run of slashes costs nothing). */
function trimSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

/** The audit row of an answer: who, what and the intent id (ids only). */
export function auditEntry(row: Pick<EverConnectProvision, 'jti' | 'state' | 'userId' | 'projectId'>): {
  action: string;
  actorRef: string;
  detail: string;
} {
  return row.state === 'created'
    ? { action: 'provision.created', actorRef: `user:${row.userId}`, detail: `project=${row.projectId} jti=${row.jti}` }
    : { action: 'provision.refused', actorRef: 'system', detail: `jti=${row.jti}` };
}

/** Whether a database error is a unique or primary key violation (PostgreSQL, MySQL, SQLite). */
function isDuplicateKey(error: unknown): boolean {
  const record = error as { code?: unknown; driverError?: { code?: unknown }; message?: unknown } | null;
  const code = record?.code || record?.driverError?.code;
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (!!record && typeof record.message === 'string' && record.message.includes('UNIQUE constraint failed'))
  );
}

/**
 * Traduora cloud provisioning from app.ever.co, hand-off only. app.ever.co sends the person to
 * `/ever-connect/provision#intent=<signed intent>`; this installation checks the intent and creates nothing until the
 * person, signed in with the same Ever ID, confirms here. Then one project is created for the organization, with that
 * person as its admin (Traduora has no organizations yet: a project is its unit with an admin), and Ever Platform is
 * told; declining tells it too. Each intent is answered once: a replay of the confirmation answers `exists`.
 *
 * Off unless `TR_EVER_CONNECT_PROVISION_ENABLED=true` (every route answers 404).
 */
@Injectable()
export class EverConnectProvisionService {
  private readonly logger = new Logger(EverConnectProvisionService.name);

  constructor(
    @InjectRepository(EverConnectProvision) private readonly provisions: Repository<EverConnectProvision>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @InjectRepository(EverConnectIntegration) private readonly integrationRows: Repository<EverConnectIntegration>,
    @Inject(EVER_CONNECT_SETTINGS) private readonly settings: EverConnectSettings,
    @Inject(EVER_INSTANCE_SETTINGS) private readonly instanceSettings: EverInstanceSettings,
    private readonly connect: EverConnectService,
    private readonly audit: EverConnectAuditService,
    @InjectRepository(EverConnectAudit) private readonly auditRows: Repository<EverConnectAudit>,
  ) {}

  /** The routes exist only with the switch on. */
  ensureEnabled(): void {
    if (!this.settings.provisionEnabled) {
      throw new NotFoundException();
    }
  }

  private nowS(): number {
    return Math.floor(Date.now() / 1000);
  }

  /** The active connection and its client: an intent addresses a connected installation only. */
  private async connected(): Promise<{ connection: EverConnectConnection; client: EverConnectPlatformClient }> {
    const live = await this.connect.liveClient();
    if (live?.connection.status !== 'active' || !live.connection.registryInstanceId) {
      throw refuse(HttpStatus.CONFLICT, 'not_connected', 'This installation is not connected to Ever Platform');
    }
    return live;
  }

  /**
   * Verifies an intent: a compact JWS, EdDSA with a key of purpose `intent` from the root-verified key set (the SDK's),
   * the Ed25519 signature, `typ`, the issuer, the audience, the product, the times, the addressed installation, and that
   * its `jti` was not answered yet. The intent itself is never stored or logged.
   */
  async verifyIntent(jws: unknown): Promise<{ claims: IntentClaims; connection: EverConnectConnection }> {
    const { connection, client } = await this.connected();
    const parts = typeof jws === 'string' && jws.length <= INTENT_MAX_LENGTH ? jws.trim().split('.') : [];
    if (parts.length !== 3) {
      throw notAnIntent();
    }
    let header: { alg?: unknown; typ?: unknown; kid?: unknown; crit?: unknown };
    let claims: IntentClaims;
    try {
      header = decodePart(parts[0]);
      claims = decodePart(parts[1]);
      if (!B64URL.test(parts[2])) throw new Error('malformed');
    } catch {
      throw notAnIntent();
    }
    if (header.alg !== 'EdDSA' || header.typ !== INTENT_HEADER_TYP || header.crit !== undefined || typeof header.kid !== 'string') {
      throw doesNotVerify();
    }
    const kid = header.kid as string;
    const nowS = this.nowS();
    let key: { x: string; issuer: string } | null;
    try {
      key = await client.intentKey(kid, nowS);
    } catch (error) {
      await this.connect.handleCallError(error, 'provision_keys', connection.kid);
      throw refuse(HttpStatus.SERVICE_UNAVAILABLE, 'platform_unavailable', 'Ever Platform could not be reached; try again later');
    }
    if (!key || !verifyBytes(key.x, Buffer.from(`${parts[0]}.${parts[1]}`, 'utf8'), Buffer.from(parts[2], 'base64url'))) {
      throw doesNotVerify();
    }
    if (claims.iss !== key.issuer) {
      throw doesNotVerify();
    }
    if (claims.aud !== INTENT_AUDIENCE) {
      throw refuse(HttpStatus.UNAUTHORIZED, 'wrong_audience', 'This intent is not for Traduora');
    }
    if (!wellFormed(claims)) {
      throw doesNotVerify();
    }
    if (claims.product !== 'traduora') {
      throw refuse(HttpStatus.UNPROCESSABLE_ENTITY, 'product_mismatch', 'This intent is for another product');
    }
    if (claims.instance_id !== undefined && claims.instance_id !== connection.registryInstanceId) {
      throw refuse(HttpStatus.UNPROCESSABLE_ENTITY, 'instance_mismatch', 'This intent is for another installation');
    }
    if (claims.iat > nowS + INTENT_SKEW_S || claims.exp - claims.iat > INTENT_MAX_TTL_S) {
      throw doesNotVerify();
    }
    if (claims.exp <= nowS) {
      throw expired();
    }
    if (await this.provisions.findOne({ where: { jti: claims.jti } })) {
      throw consumed();
    }
    return { claims, connection };
  }

  /** `POST /provision/intent`: checks the intent and seals what the confirmation needs; creates nothing. */
  async intent(jws: unknown) {
    const { claims, connection } = await this.verifyIntent(jws);
    // Sealed for the installation that verified it: a connection replaced meanwhile cannot open it
    const current = await this.connected();
    if (current.connection.registryInstanceId !== connection.registryInstanceId) {
      throw refuse(HttpStatus.CONFLICT, 'not_connected', 'The connection of this installation changed; open the link again');
    }
    const txn: ProvisionTxn = {
      jti: claims.jti,
      sub: claims.person.ever_id_sub,
      org: { id: claims.org.id, handle: claims.org.handle, displayName: claims.org.display_name.trim().slice(0, PROJECT_NAME_MAX) },
      returnTo: returnAddress(claims.return_to),
      // The confirmation is valid while the intent is, and never longer than 15 minutes
      exp: Math.min(claims.exp, this.nowS() + INTENT_MAX_TTL_S),
    };
    const provisionTxn = sealTxn(txn, this.instanceSettings.secret, connection.registryInstanceId);
    // Never more than the confirm and reject routes take (the bounds of each field keep real intents far below it)
    if (provisionTxn.length > PROVISION_TXN_MAX) {
      throw refuse(HttpStatus.UNPROCESSABLE_ENTITY, 'intent_too_large', 'This intent carries more than a confirmation can hold');
    }
    return {
      provisionTxn,
      jti: txn.jti,
      handle: txn.org.handle,
      displayName: txn.org.displayName,
      expiresAt: txn.exp * 1000,
    };
  }

  /** Opens a sealed confirmation (made by this installation for its current connection, and not expired). */
  private async open(provisionTxn: unknown): Promise<{ txn: ProvisionTxn; connection: EverConnectConnection }> {
    const { connection } = await this.connected();
    let txn: ProvisionTxn;
    try {
      const text = unwrapKey(
        typeof provisionTxn === 'string' ? provisionTxn : '',
        this.instanceSettings.secret,
        connection.registryInstanceId,
        PROVISION_TXN_PURPOSE,
      );
      txn = JSON.parse(text.toString('utf8'));
    } catch (error) {
      if (error instanceof EverInstanceKeyError && error.code === 'secret_missing') {
        throw error;
      }
      throw invalidTxn();
    }
    if (!txn || typeof txn.jti !== 'string' || !JTI.test(txn.jti) || typeof txn.sub !== 'string' || !txn.org || !Number.isInteger(txn.exp)) {
      throw invalidTxn();
    }
    if (txn.exp <= this.nowS()) {
      throw expired();
    }
    return { txn, connection };
  }

  /**
   * Whether the account holds this Ever ID: an Ever ID sign-in (an identity that names an Ever person id) with the
   * intent's subject, from the Ever ID issuer this installation signs in with (`TR_AUTH_EVERID_ISSUER`). Only that
   * issuer: a subject means one person within its issuer, and the issuers of `TR_AUTH_EVERID_ALLOWED_ISSUERS` (others,
   * for instance during a move of the identity provider) have subjects of their own.
   */
  private async hasEverId(userId: string, subject: string): Promise<boolean> {
    const issuer = everIdIssuer();
    if (!issuer) return false;
    const rows = await this.identities.find({ where: { user: { id: userId }, provider: 'everid', subject } });
    return rows.some(row => !!row.everPersonId && trimSlashes(String(row.issuer || '').trim()) === issuer);
  }

  /**
   * `POST /provision/confirm`: the person, signed in with the intent's Ever ID, confirms. In one transaction the intent
   * is claimed (its `jti` is the key of the answer) and one project is created with the person as its admin; then Ever
   * Platform is told. A replay by the same person answers `exists` and creates nothing.
   */
  async confirm(provisionTxn: unknown, userId: string) {
    const { txn, connection } = await this.open(provisionTxn);
    if (!(await this.hasEverId(userId, txn.sub))) {
      throw refuse(HttpStatus.FORBIDDEN, 'intent_subject_mismatch', 'Sign in with the same Ever ID you used on app.ever.co');
    }
    const existing = await this.provisions.findOne({ where: { jti: txn.jti } });
    if (existing) {
      return this.replay(existing, userId, txn);
    }
    let projectId: string;
    try {
      projectId = await this.provisions.manager.transaction(async tx => {
        const now = Date.now();
        // The claim first: a second confirmation of the same intent waits for this one, then fails on the key
        await tx.insert(EverConnectProvision, {
          jti: txn.jti,
          state: 'created',
          userId,
          projectId: null,
          instanceId: connection.registryInstanceId,
          audited: false,
          orgId: txn.org.id,
          tenantLinkId: null,
          pendingComplete: true,
          completeRefused: null,
          at: now,
        });
        const user = await tx.findOne(User, { where: { id: userId } });
        if (!user) {
          throw new NotFoundException();
        }
        // The project is counted first, only while under the limit: two confirmations at once cannot both pass it
        const counted = await tx.increment(User, { id: user.id, numProjectsCreated: LessThan(config.maxProjectsPerUser) }, 'numProjectsCreated', 1);
        if (!counted.affected) {
          throw refuse(HttpStatus.CONFLICT, 'project_limit', 'This account cannot create more projects');
        }
        // As the projects route creates one: in the person's organization (the default one of a single-tenant install,
        // otherwise the one they own), with the person as its admin and the default plan
        const organizationId = await homeOrganizationId(tx, user);
        // Only into an active organization (a suspended default organization of a single-tenant install, say): a refusal
        // here rolls back the claim of the intent and the project count
        const organization = await tx.findOne(Organization, { where: { id: organizationId } });
        if (organization?.status !== OrganizationStatus.Active) {
          throw refuse(HttpStatus.FORBIDDEN, 'organization_suspended', 'Your organization is suspended: no project can be created in it');
        }
        const project = await tx.save(tx.create(Project, { name: txn.org.displayName.slice(0, PROJECT_NAME_MAX), organizationId }));
        await tx.save(tx.create(ProjectUser, { user, project, role: ProjectRole.Admin }));
        project.plan = await tx.findOneOrFail(Plan, { where: { code: config.defaultProjectPlan } });
        await tx.save(project);
        await tx.update(EverConnectProvision, { jti: txn.jti }, { projectId: project.id });
        return project.id;
      });
    } catch (error) {
      if (isDuplicateKey(error)) {
        // Another confirmation of the same intent won the claim
        const winner = await this.provisions.findOne({ where: { jti: txn.jti } });
        if (winner) {
          return this.replay(winner, userId, txn);
        }
      }
      throw error;
    }
    this.logger.log(`ever_connect.provision outcome=created project=${projectId}`);
    // The project exists: the answer is the person's, even when the audit row has to be written later
    await this.recordAudit(txn.jti);
    await this.complete(txn.jti).catch(error => this.logger.warn(`ever_connect.provision complete=later reason=${this.reason(error)}`));
    return { status: 'created', projectId, returnTo: txn.returnTo };
  }

  /** The answer to an intent already answered: `exists` for the person it was created for, otherwise used. */
  private async replay(existing: EverConnectProvision, userId: string, txn: ProvisionTxn) {
    if (existing.state === 'created' && existing.userId === userId && existing.projectId) {
      // A completion that did not reach Ever Platform yet is sent again
      await this.complete(txn.jti).catch(() => undefined);
      return { status: 'exists', projectId: existing.projectId, returnTo: txn.returnTo };
    }
    throw consumed();
  }

  /** `POST /provision/intents/:jti/reject`: the person declines; nothing is created and Ever Platform is told. */
  async reject(jti: string, provisionTxn: unknown) {
    const { txn, connection } = await this.open(provisionTxn);
    if (txn.jti !== jti) {
      throw invalidTxn();
    }
    try {
      await this.provisions.insert({
        jti,
        state: 'refused',
        userId: null,
        projectId: null,
        instanceId: connection.registryInstanceId,
        audited: false,
        orgId: txn.org.id,
        tenantLinkId: null,
        pendingComplete: true,
        completeRefused: null,
        at: Date.now(),
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      const existing = await this.provisions.findOne({ where: { jti } });
      if (existing?.state === 'refused') {
        return { status: 'refused', returnTo: txn.returnTo };
      }
      throw consumed();
    }
    await this.recordAudit(jti);
    await this.complete(jti).catch(error => this.logger.warn(`ever_connect.provision complete=later reason=${this.reason(error)}`));
    return { status: 'refused', returnTo: txn.returnTo };
  }

  /**
   * Tells Ever Platform what became of an intent (`/v1/provision-intents/{jti}/complete`): the project and the person for
   * a creation, `none` for a refusal. A completion Ever Platform no longer takes (404, 409, 410) is final and recorded;
   * any other failure leaves it pending, and the background round sends it again.
   */
  async complete(jti: string): Promise<void> {
    const row = await this.provisions.findOne({ where: { jti } });
    if (!row?.pendingComplete) return;
    const live = await this.connect.liveClient();
    if (live?.connection.status !== 'active' || !live.connection.registryInstanceId) {
      throw new Error('not_connected');
    }
    if (row.instanceId && row.instanceId !== live.connection.registryInstanceId) {
      // Answered for another connection of this installation (it was disconnected and connected again): never sent under
      // this one. Kept as answered here, and retired from sending.
      await this.provisions.update({ jti, pendingComplete: true }, { pendingComplete: false, completeRefused: 'connection_changed' });
      this.logger.warn(`ever_connect.provision complete=retired reason=connection_changed state=${row.state}`);
      return;
    }
    const app = await this.publicAddress();
    const body: ProvisionComplete =
      row.state === 'created'
        ? {
            instance_id: live.connection.registryInstanceId,
            product_tenant_id: row.projectId,
            product_user_ref: row.userId,
            ...(app ? { urls: { app } } : {}),
            result: 'created',
          }
        : { instance_id: live.connection.registryInstanceId, product_tenant_id: 'none', result: 'refused' };
    let tenantLinkId: string | null = null;
    let finalRefusal: string | null = null;
    try {
      tenantLinkId = (await live.client.completeProvisionIntent(jti, body)).tenantLinkId;
    } catch (error) {
      const problem = problemOf(error);
      if (!problem || ![404, 409, 410].includes(problem.status)) {
        await this.connect.handleCallError(error, 'provision_complete', live.connection.kid);
        throw error;
      }
      finalRefusal = `${problem.status}:${problem.code}`.slice(0, 48);
    }
    // Only while still pending: of two overlapping sends (the person's and the background round's) the first answer stays
    await this.provisions.update({ jti, pendingComplete: true }, { pendingComplete: false, tenantLinkId, completeRefused: finalRefusal });
    const outcome = finalRefusal ? `refused reason=${finalRefusal}` : 'sent';
    this.logger.log(`ever_connect.provision complete=${outcome} state=${row.state}`);
  }

  /**
   * The address of this installation the operator gave Ever Platform (the `instance_url` integration), sent with a
   * creation so that app.ever.co can open the project; none when the operator gave none (never guessed from the server).
   */
  private async publicAddress(): Promise<string | null> {
    const row = await this.integrationRows.findOne({ where: { key: 'instance_url' } });
    if (row?.state !== 'enabled' || !row.config) return null;
    try {
      return returnAddress(JSON.parse(row.config).base_url);
    } catch {
      return null;
    }
  }

  /** Sends the completions Ever Platform has not received yet (called by the background round). */
  async retryPendingCompletes(): Promise<void> {
    // Switched off: what is pending waits until the operator turns provisioning on again
    if (!this.settings.provisionEnabled) return;
    for (const row of await this.provisions.find({ where: { audited: false }, take: 20 })) {
      await this.recordAudit(row.jti);
    }
    const pending = await this.provisions.find({ where: { pendingComplete: true }, take: 20 });
    for (const row of pending) {
      await this.complete(row.jti).catch(() => undefined);
    }
  }

  /**
   * Writes the audit row of an answer once (`provision.created` or `provision.refused`, naming the intent id) and never
   * fails the answer. The writing is claimed first, so that the person's request and the background round do not both
   * write it; a claim that was interrupted (the process stopped) is taken again after 5 minutes, and a retry first looks
   * for the row it may have written already, so a row is neither lost nor written twice. The flag is set last.
   */
  private async recordAudit(jti: string): Promise<void> {
    // This caller's claim (a time no other caller uses): only it is checked again and released
    let mine: number | null = null;
    try {
      const row = await this.provisions.findOne({ where: { jti } });
      if (!row || row.audited) return;
      const now = Date.now();
      const claimed =
        (await this.provisions.update({ jti, audited: false, auditClaimedAt: IsNull() }, { auditClaimedAt: now })).affected ||
        (await this.provisions.update({ jti, audited: false, auditClaimedAt: LessThan(now - AUDIT_CLAIM_STALE_MS) }, { auditClaimedAt: now }))
          .affected;
      if (!claimed) return;
      mine = now;
      const entry = auditEntry(row);
      if (!(await this.auditRows.count({ where: { action: entry.action, detail: entry.detail } }))) {
        // Still this caller's claim right before the write: a caller that stalled past the stale time stops here
        if (!(await this.provisions.count({ where: { jti, audited: false, auditClaimedAt: mine } }))) return;
        await this.audit.record(entry.action, entry.actorRef, entry.detail);
      }
      await this.provisions.update({ jti, auditClaimedAt: mine }, { audited: true, auditClaimedAt: null });
    } catch (error) {
      // The answer stands: the background round writes the row later. Only this caller's own claim is released.
      if (mine !== null) {
        await this.provisions.update({ jti, audited: false, auditClaimedAt: mine }, { auditClaimedAt: null }).catch(() => undefined);
      }
      this.logger.warn(`ever_connect.provision audit=later reason=${error?.name || 'error'}`);
    }
  }

  private reason(error: unknown): string {
    const problem = problemOf(error);
    if (problem) return [problem.status, problem.code].join(':');
    return (error instanceof Error && error.message) || 'error';
  }
}
