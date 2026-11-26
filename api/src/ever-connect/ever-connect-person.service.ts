import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { subjectHash } from '@ever-co/connect-sdk';
import { EntityManager, IsNull, LessThan, Not, Repository } from 'typeorm';
import { EverConnectConnection } from '../entity/ever-connect-connection.entity';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverConnectPersonExport } from '../entity/ever-connect-person-export.entity';
import { EverConnectPersonLink } from '../entity/ever-connect-person-link.entity';
import { EverConnectPersonRequest } from '../entity/ever-connect-person-request.entity';
import { EverIdSession } from '../entity/ever-id-session.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { TranslationHistory } from '../entity/translation-history.entity';
import { IdentityLinkMethod, UserIdentity } from '../entity/user-identity.entity';
import { User } from '../entity/user.entity';
import { DbType, isDbType } from '../utils/database-type-helper';
import { lockProject, readCommittedTransaction } from '../utils/database-locks';
import { normalizeEmail } from '../ever-platform/env';
import { EVER_INSTANCE_SETTINGS, EverInstanceSettings } from '../ever-instance/ever-instance.settings';
import { KeyPurpose, unwrapKey, wrapKey } from '../ever-instance/key-wrap';
import { EverConnectAuditService } from './ever-connect-audit.service';
import { EverConnectPlatformClient, PersonRequestAnswer, PlatformEvent, problemOf } from './ever-connect-platform.client';
import { CONNECTION_ID, EverConnectService } from './ever-connect.service';
import { EVER_CONNECT_SETTINGS, EverConnectSettings } from './ever-connect.settings';
import { lockAccount } from '../services/ever-id-session.service';

/** The feed events of a person's requests, by the kind of request. */
export const PERSON_REQUEST_TYPES: Readonly<Record<string, 'deletion' | 'export'>> = Object.freeze({
  'ever.registry.person.deletion_requested': 'deletion',
  'ever.registry.person.export_requested': 'export',
});

/** How long a person's export can be downloaded. */
export const PERSON_EXPORT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long the receipt of an answered request is kept. */
export const PERSON_REQUEST_KEPT_MS = 90 * 24 * 60 * 60 * 1000;

/** How often the person links are compared with the Ever IDs of the users (unless something asks for it sooner). */
export const PERSON_LINK_SYNC_MS = 5 * 60 * 1000;

/** At most this many person link calls per comparison: the rest follow with the next one. */
export const PERSON_LINK_CALLS_PER_SYNC = 100;

/** A person link Ever Platform refused or could not take is tried again after this long (others go first meanwhile). */
export const PERSON_LINK_RETRY_MS = 60 * 60 * 1000;

const SWEEP_MS = 60 * 60 * 1000;

/** An export is encrypted for its own purpose: no other blob opens as one, and no export opens as another. */
export const PERSON_EXPORT_PURPOSE: KeyPurpose = { info: 'ever-connect/person-export', aad: 'ever_connect:person_export' };

/** The page of the webapp where a signed-in account finds its exports (*My data exports*). */
export const PERSON_EXPORT_PAGE = '/user-settings';

/** Why an account is kept rather than deleted for Ever Platform (logged by code only). */
export type PersonDeletionHold = 'operator' | 'project_last_admin';

/**
 * The address of the page where an account downloads its exports, under `appUrl` (`TR_VIRTUAL_HOST`): https only,
 * without credentials, at most 2048 characters (what Ever Platform accepts); `null` otherwise.
 */
export function personExportUrl(appUrl: string | undefined): string | null {
  let url: URL;
  try {
    url = new URL((appUrl || '').trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) {
    return null;
  }
  let path = url.pathname;
  while (path.endsWith('/')) path = path.slice(0, -1);
  const address = `${url.origin}${path}${PERSON_EXPORT_PAGE}`;
  return address.length <= 2048 ? address : null;
}

const JOB_ID = /^[0-9A-Za-z_-]{1,64}$/;
const SUBJECT_HASH = /^[0-9a-f]{64}$/;

/** The identity columns this module reads (never the provider's tokens: Traduora stores none). */
interface IdentityRow {
  id: string;
  userId: string;
  provider: string;
  issuer: string;
  subject: string;
  everPersonId: string | null;
  emailAtLink: string;
  linkMethod: string;
  linkedAt: Date;
  lastLoginAt: Date | null;
}

/** What one export holds: the account's own data, nothing about other people. */
export interface PersonExportBundle {
  format: 'ever-traduora.person-export.v1';
  created_at: string;
  account: { id: string; name: string; email: string; email_verified: boolean; created_at: string | null; last_login_at: string | null };
  identities: Array<{
    provider: string;
    issuer: string;
    subject: string;
    email_at_link: string;
    link_method: string;
    linked_at: string | null;
    last_login_at: string | null;
  }>;
  projects: Array<{ id: string; name: string; role: string; member_since: string | null }>;
  translation_changes: number;
}

const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** The subject hashes of a request (`subject_hashes`, and the older single `subject_hash`), lower-cased and checked. */
export function subjectHashesOf(data: Record<string, unknown> | null | undefined): string[] {
  const values: unknown[] = [];
  if (data && Array.isArray(data.subject_hashes)) values.push(...data.subject_hashes);
  if (data && data.subject_hash !== undefined) values.push(data.subject_hash);
  const hashes = values.filter((value): value is string => typeof value === 'string').map(value => value.toLowerCase());
  return Array.from(new Set(hashes.filter(hash => SUBJECT_HASH.test(hash))));
}

/**
 * A person's Ever ID and this installation, while it is connected:
 *
 * - person links: each Ever ID a user signed in with (and so linked to their account themselves, or confirmed when the
 *   account was made) is reported to Ever Platform, ids only, while an organization consented to `ever_id_login` and
 *   this installation does not deny it; a link whose identity was removed here is removed there. No account is ever
 *   created or changed for a link.
 * - deletion requests: the person's Ever IDs are removed from the accounts they are linked to and the sessions opened
 *   with them end. With `TR_EVER_CONNECT_PERSON_DELETION_ENABLED=true`, the accounts are then deleted as *Delete account*
 *   deletes them, unless one is held ({@link deletionHold}): answered `deleted`. Otherwise the accounts, their passwords
 *   and other sign-in methods stay and the answer is `failed` (`account_deletion_pending`): Ever Platform keeps the
 *   request open, and the person deletes the account in Traduora. Nothing matched: `no_account`.
 * - export requests: with `TR_EVER_CONNECT_PERSON_EXPORT_ENABLED=true` and an https `TR_VIRTUAL_HOST`, one export per
 *   matched account (its profile, its Ever IDs, its projects with the role, how many translation changes it made),
 *   encrypted and downloadable by that account only, for 7 days, from its account settings: answered `exported` with that
 *   page's address (Ever Platform refuses `exported` without one). Otherwise no export is made and the answer is `failed`
 *   (`export_not_available`). Nothing matched: `no_account`.
 *
 * Nothing is matched by e-mail: only by the hash of an Ever ID (issuer and subject) the request names.
 */
@Injectable()
export class EverConnectPersonService {
  private readonly logger = new Logger(EverConnectPersonService.name);
  private lastSyncAt = 0;
  private lastSweepAt = 0;
  private syncRequested = false;

  constructor(
    @InjectRepository(EverConnectPersonLink) private readonly links: Repository<EverConnectPersonLink>,
    @InjectRepository(EverConnectPersonRequest) private readonly requests: Repository<EverConnectPersonRequest>,
    @InjectRepository(EverConnectPersonExport) private readonly exports: Repository<EverConnectPersonExport>,
    @InjectRepository(EverConnectIntegration) private readonly integrationRows: Repository<EverConnectIntegration>,
    @InjectRepository(UserIdentity) private readonly identities: Repository<UserIdentity>,
    @Inject(EVER_CONNECT_SETTINGS) private readonly settings: EverConnectSettings,
    @Inject(EVER_INSTANCE_SETTINGS) private readonly instanceSettings: EverInstanceSettings,
    private readonly connect: EverConnectService,
    private readonly audit: EverConnectAuditService,
  ) {}

  // Requests

  /** Whether `type` is a person's request this module answers. */
  static isRequest(type: string): boolean {
    return Object.prototype.hasOwnProperty.call(PERSON_REQUEST_TYPES, type);
  }

  /**
   * Answers the person requests of a feed page, one after the other. Throws when one could not be answered: the page is
   * then read again, and a request already decided is answered the same way.
   */
  async handleEvents(client: EverConnectPlatformClient, events: ReadonlyArray<PlatformEvent>): Promise<number> {
    let handled = 0;
    for (const event of events) {
      if (EverConnectPersonService.isRequest(event.type)) {
        await this.handle(client, event);
        handled += 1;
      }
    }
    if (handled) {
      // A removed Ever ID is a person link to remove
      this.requestSync();
    }
    return handled;
  }

  /** One deletion or export request. */
  async handle(client: EverConnectPlatformClient, event: PlatformEvent): Promise<void> {
    const kind = PERSON_REQUEST_TYPES[event.type];
    const data = event.data || {};
    const jobId = typeof data.job_id === 'string' && JOB_ID.test(data.job_id) ? data.job_id : null;
    if (!kind || !jobId) {
      this.logger.warn(`ever_connect.person_request outcome=ignored reason=${kind ? 'no_job_id' : 'unknown_type'}`);
      return;
    }
    let request = await this.receipt(jobId, kind);
    if (request.kind !== kind) {
      this.logger.warn(`ever_connect.person_request outcome=ignored reason=kind_mismatch`);
      return;
    }
    if (!request.result) {
      request = await this.decide(request, subjectHashesOf(data));
    }
    if (!request.answeredAt) {
      await this.answer(client, request);
    }
  }

  /** The receipt of a request, made when the request is first read. */
  private async receipt(jobId: string, kind: string): Promise<EverConnectPersonRequest> {
    const existing = await this.requests.findOne({ where: { jobId } });
    if (existing) return existing;
    const row = Object.assign(new EverConnectPersonRequest(), {
      jobId,
      kind,
      result: null,
      reasonCode: null,
      accounts: 0,
      receivedAt: Date.now(),
      answeredAt: null,
    });
    try {
      await this.requests.insert(row);
      return row;
    } catch (error) {
      // Another API process read the same request at the same moment
      const again = await this.requests.findOne({ where: { jobId } });
      if (again) return again;
      throw error;
    }
  }

  /** The identities whose Ever ID hash is one of `hashes`, with the account they belong to. */
  private async matching(manager: EntityManager, hashes: string[]): Promise<IdentityRow[]> {
    if (!hashes.length) return [];
    const wanted = new Set(hashes);
    return (await this.identityRows(manager)).filter(row => wanted.has(subjectHash(row.issuer, row.subject)));
  }

  private async identityRows(manager: EntityManager = this.identities.manager): Promise<IdentityRow[]> {
    const rows = await manager.getRepository(UserIdentity).find({
      select: {
        id: true,
        provider: true,
        issuer: true,
        subject: true,
        everPersonId: true,
        emailAtLink: true,
        linkMethod: true,
        linkedAt: true,
        lastLoginAt: true,
        user: { id: true },
      },
      relations: { user: true },
    });
    return rows
      .filter(row => row.user && row.user.id)
      .map(row => ({
        id: row.id,
        userId: row.user.id,
        provider: row.provider,
        issuer: row.issuer,
        subject: row.subject,
        everPersonId: row.everPersonId,
        emailAtLink: row.emailAtLink,
        linkMethod: row.linkMethod,
        linkedAt: row.linkedAt,
        lastLoginAt: row.lastLoginAt,
      }));
  }

  /**
   * Decides the answer once, in one transaction with what it changes. The receipt is locked first (PostgreSQL, MySQL;
   * SQLite runs one write transaction at a time), so two API processes reading the same request never decide twice: the
   * second finds the answer of the first.
   */
  private async decide(request: EverConnectPersonRequest, hashes: string[]): Promise<EverConnectPersonRequest> {
    let decidedHere = false;
    // READ COMMITTED (MySQL reads as of the first read otherwise): an admin count taken after a project lock wait sees
    // the deletion the other transaction committed meanwhile
    const decided = await readCommittedTransaction(this.requests.manager, async manager => {
      const locked = await manager.findOne(EverConnectPersonRequest, {
        where: { jobId: request.jobId },
        ...(isDbType(DbType.BETTER_SQLITE3) ? {} : { lock: { mode: 'pessimistic_write' as const } }),
      });
      if (locked && locked.result) {
        return locked;
      }
      const row = locked || request;
      const matches = await this.matching(manager, hashes);
      const userIds = Array.from(new Set(matches.map(identity => identity.userId)));
      row.accounts = userIds.length;
      row.reasonCode = null;
      if (!matches.length) {
        row.result = 'no_account';
      } else if (row.kind === 'deletion') {
        await this.deleteIdentities(manager, matches);
        if (await this.deleteAccounts(manager, userIds)) {
          row.result = 'deleted';
        } else {
          row.result = 'failed';
          row.reasonCode = 'account_deletion_pending';
        }
      } else if (this.settings.personExportEnabled && personExportUrl(this.settings.appUrl)) {
        row.accounts = await this.exportAccounts(manager, row.jobId, matches);
        row.result = row.accounts ? 'exported' : 'no_account';
      } else {
        row.result = 'failed';
        row.reasonCode = 'export_not_available';
      }
      await manager.update(
        EverConnectPersonRequest,
        { jobId: row.jobId },
        { result: row.result, reasonCode: row.reasonCode, accounts: row.accounts },
      );
      decidedHere = true;
      return row;
    });
    if (decidedHere) {
      await this.audit.record(`person.${decided.kind}`, 'platform', `result=${decided.result} accounts=${decided.accounts}`);
      this.logger.log(`ever_connect.person_request kind=${decided.kind} result=${decided.result} accounts=${decided.accounts}`);
    }
    return decided;
  }

  /**
   * A deletion request: the matched Ever IDs are removed from their accounts and the sessions opened with them end. The
   * accounts, their passwords and other sign-in methods stay: the person can still sign in with them, or reset the
   * password, and delete the account in Traduora.
   */
  private async deleteIdentities(manager: EntityManager, matches: IdentityRow[]): Promise<void> {
    const now = Date.now();
    // Each account's row locked first, as a sign-in that opens a session locks it (in one order: two deletions never
    // deadlock), so a sign-in that read the identity just before cannot open a session once it is removed
    for (const userId of Array.from(new Set(matches.map(identity => identity.userId))).sort((a, b) => a.localeCompare(b))) {
      await lockAccount(manager, userId);
    }
    for (const identity of matches) {
      await manager.update(EverIdSession, { userId: identity.userId, revokedAt: IsNull() }, { revokedAt: new Date(now) });
      await manager.delete(UserIdentity, { id: identity.id });
      // Its person link is now a removal to tell Ever Platform (see syncLinks)
      if (!(await manager.findOne(EverConnectPersonLink, { where: { userIdentityId: identity.id } }))) {
        await manager.insert(EverConnectPersonLink, {
          userIdentityId: identity.id,
          userId: identity.userId,
          reportedAt: null,
          tenantLinkId: null,
          retryAt: null,
          updatedAt: now,
        });
      }
    }
  }

  /**
   * With `TR_EVER_CONNECT_PERSON_DELETION_ENABLED`, deletes the accounts, all or none, in the request's transaction: as
   * *Delete account* does (the account row; its project memberships, Ever IDs and other rows that belong to it go with it,
   * its translation history stays without a name), once no account is held. `false` when nothing was deleted: switched
   * off, or an account is held.
   */
  private async deleteAccounts(manager: EntityManager, userIds: string[]): Promise<boolean> {
    if (!this.settings.personDeletionEnabled) return false;
    for (const userId of userIds) {
      const hold = await this.deletionHold(manager, userId, userIds);
      if (hold) {
        this.logger.warn(`ever_connect.person_request kind=deletion held=${hold}`);
        return false;
      }
    }
    const users = manager.getRepository(User);
    for (const userId of userIds) {
      const user = await users.findOne({ where: { id: userId } });
      if (user) await users.remove(user);
    }
    return true;
  }

  /**
   * Why an account must not be deleted for Ever Platform, `null` when it may be. Reads only.
   *
   * - `operator`: the account operates this installation (`TR_EVER_ADMIN_EMAILS`).
   * - `project_last_admin`: no admin outside the accounts being deleted (`deleting`) is left in a project the account
   *   administers. With other people in it, *Delete account* refuses as well; alone, the project would stay with nobody
   *   to reach it. The person hands the project over, or deletes it, in Traduora first.
   *
   * The project's row is locked while its admins are counted ({@link lockProject}; SQLite runs one write transaction at
   * a time), and the request's transaction reads committed rows: another deletion through this path waits for this one
   * and then counts what it left.
   */
  async deletionHold(manager: EntityManager, userId: string, deleting: ReadonlyArray<string> = [userId]): Promise<PersonDeletionHold | null> {
    const user = await manager.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return null;
    // Both sides normalized (`TR_EVER_ADMIN_EMAILS` is read that way); an account without an e-mail is no operator
    const email = normalizeEmail(user.email);
    if (email && this.instanceSettings.adminEmails.map(normalizeEmail).includes(email)) {
      return 'operator';
    }
    const memberships = manager.getRepository(ProjectUser);
    const administered = await memberships.find({ where: { user: { id: userId }, role: ProjectRole.Admin }, relations: { project: true } });
    for (const membership of administered) {
      if (!membership.project) continue;
      await lockProject(manager, membership.project.id);
      const admins = await memberships.find({
        where: { project: { id: membership.project.id }, role: ProjectRole.Admin },
        relations: { user: true },
      });
      if (!admins.some(admin => admin.user && !deleting.includes(admin.user.id))) return 'project_last_admin';
    }
    return null;
  }

  /** An export request: one encrypted export per matched account, each with that account's own data only. */
  private async exportAccounts(manager: EntityManager, jobId: string, matches: IdentityRow[]): Promise<number> {
    const userIds = Array.from(new Set(matches.map(identity => identity.userId)));
    const now = Date.now();
    let accounts = 0;
    for (const userId of userIds) {
      const bundle = await this.bundleFor(
        manager,
        userId,
        matches.filter(identity => identity.userId === userId),
        now,
      );
      if (!bundle) continue;
      await manager.save(
        Object.assign(new EverConnectPersonExport(), {
          jobId,
          userId,
          bundleEnc: wrapKey(Buffer.from(JSON.stringify(bundle), 'utf8'), this.instanceSettings.secret, `${jobId}:${userId}`, PERSON_EXPORT_PURPOSE),
          createdAt: now,
          expiresAt: now + PERSON_EXPORT_TTL_MS,
        }),
      );
      accounts += 1;
    }
    return accounts;
  }

  /** The account's own data: its profile, the matched Ever IDs, its projects and roles, its number of translation changes. */
  private async bundleFor(manager: EntityManager, userId: string, identities: IdentityRow[], now: number): Promise<PersonExportBundle | null> {
    const user = await manager.getRepository(User).findOne({ where: { id: userId } });
    if (!user) return null;
    const memberships = await manager.getRepository(ProjectUser).find({ where: { user: { id: userId } }, relations: { project: true } });
    const translationChanges = await manager.getRepository(TranslationHistory).count({ where: { user: { id: userId } } });
    return {
      format: 'ever-traduora.person-export.v1',
      created_at: new Date(now).toISOString(),
      account: {
        id: user.id,
        name: user.name,
        email: user.email,
        email_verified: user.emailVerified === true,
        created_at: iso(user.date && user.date.created),
        last_login_at: iso(user.lastLogin),
      },
      identities: identities.map(identity => ({
        provider: identity.provider,
        issuer: identity.issuer,
        subject: identity.subject,
        email_at_link: identity.emailAtLink,
        link_method: identity.linkMethod,
        linked_at: iso(identity.linkedAt),
        last_login_at: iso(identity.lastLoginAt),
      })),
      projects: memberships
        .filter(membership => membership.project)
        .map(membership => ({
          id: membership.project.id,
          name: membership.project.name,
          role: membership.role,
          member_since: iso(membership.date && membership.date.created),
        })),
      translation_changes: translationChanges,
    };
  }

  /**
   * Sends the decided answer. An answer Ever Platform already holds, a request it did not send to this installation, or
   * an answer it refuses as it stands is not sent again; anything else (no connection, a busy or failing platform)
   * throws, so it is sent again with the next read of the feed.
   */
  private async answer(client: EverConnectPlatformClient, request: EverConnectPersonRequest): Promise<void> {
    const exportUrl = request.result === 'exported' ? personExportUrl(this.settings.appUrl) : null;
    if (request.result === 'exported' && !exportUrl) {
      // Decided while TR_VIRTUAL_HOST was https, and it no longer is: Ever Platform refuses `exported` without the
      // address, so the answer becomes the one an installation without an address gives (not final: the request stays
      // open there, and the person can ask again)
      this.logger.warn('ever_connect.person_request kind=export outcome=export_url_unavailable');
      request.result = 'failed';
      request.reasonCode = 'export_not_available';
      await this.requests.update({ jobId: request.jobId }, { result: request.result, reasonCode: request.reasonCode });
    }
    const answer: PersonRequestAnswer = {
      jobId: request.jobId,
      result: request.result as PersonRequestAnswer['result'],
      ...(request.reasonCode ? { reasonCode: request.reasonCode } : {}),
      ...(exportUrl ? { exportUrl } : {}),
    };
    let outcome = 'answered';
    try {
      await client.answerPersonRequest(answer);
    } catch (error) {
      const problem = problemOf(error);
      if (!problem || problem.status === 401 || problem.status === 429 || problem.status >= 500) {
        throw error;
      }
      outcome = `not_needed:${problem.status}:${problem.code}`;
    }
    await this.requests.update({ jobId: request.jobId }, { answeredAt: Date.now() });
    this.logger.log(`ever_connect.person_request kind=${request.kind} outcome=${outcome}`);
  }

  // Exports

  /** The exports a signed-in account can download now (ids and dates only). */
  async listExports(userId: string): Promise<Array<{ jobId: string; createdAt: number; expiresAt: number }>> {
    const rows = await this.exports.find({ select: { jobId: true, userId: true, createdAt: true, expiresAt: true }, where: { userId } });
    const now = Date.now();
    return rows
      .filter(row => row.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(row => ({ jobId: row.jobId, createdAt: row.createdAt, expiresAt: row.expiresAt }));
  }

  /** One export, for the account it was made of only (404 for anyone else, and once it expired). */
  async download(jobId: string, userId: string): Promise<PersonExportBundle> {
    if (typeof jobId !== 'string' || !JOB_ID.test(jobId) || !userId) {
      throw new NotFoundException();
    }
    const row = await this.exports.findOne({ where: { jobId, userId } });
    if (!row || row.expiresAt <= Date.now()) {
      throw new NotFoundException();
    }
    let text: string;
    try {
      text = unwrapKey(row.bundleEnc, this.instanceSettings.secret, `${jobId}:${userId}`, PERSON_EXPORT_PURPOSE).toString('utf8');
    } catch {
      // TR_SECRET changed since the export was made: it cannot be read any more
      throw new NotFoundException();
    }
    return JSON.parse(text) as PersonExportBundle;
  }

  /** Deletes expired exports and the receipts of requests answered more than 90 days ago (at most once an hour). */
  async sweep(now = Date.now(), force = false): Promise<void> {
    if (!force && now - this.lastSweepAt < SWEEP_MS) return;
    this.lastSweepAt = now;
    await this.exports.delete({ expiresAt: LessThan(now) });
    // Kept 90 days from the answer: a request read again meanwhile gets the same answer
    await this.requests.delete({ answeredAt: LessThan(now - PERSON_REQUEST_KEPT_MS) });
  }

  // Person links

  /**
   * Records a reported link only while the connection that reported it is still the active one, in one transaction with
   * a lock on the connection row: a disconnect (which deletes every link) either comes after it or makes it a no-op, so
   * a link of an ended connection is never recorded as reported.
   */
  private saveIfConnected(kid: string | null, row: EverConnectPersonLink): Promise<boolean> {
    return this.links.manager.transaction(async manager => {
      const current = await manager.findOne(EverConnectConnection, {
        where: { id: CONNECTION_ID },
        ...(isDbType(DbType.BETTER_SQLITE3) ? {} : { lock: { mode: 'pessimistic_write' as const } }),
      });
      if (!current || current.kid !== kid || current.status !== 'active') {
        return false;
      }
      await manager.save(row);
      return true;
    });
  }

  /** Asks for a comparison of the person links at the next scheduler round. */
  requestSync(): void {
    this.syncRequested = true;
  }

  /** Whether person links are reported: `ever_id_login` enabled by an organization's consent and not denied here. */
  async reporting(): Promise<boolean> {
    if (this.settings.integrationsDeny.includes('ever_id_login')) return false;
    const row = await this.integrationRows.findOne({ where: { key: 'ever_id_login' } });
    return !!row && row.state === 'enabled' && !row.pendingRemoteRevoke;
  }

  /** The identities that are reported: an Ever ID (it named an Ever person id) the user linked or confirmed themselves. */
  private static reportable(identity: IdentityRow): boolean {
    return !!identity.everPersonId && (identity.linkMethod === IdentityLinkMethod.Explicit || identity.linkMethod === IdentityLinkMethod.Jit);
  }

  /**
   * Compares the person links with the users' Ever IDs (every 5 minutes, or sooner when an event asks for it): a link
   * whose identity is gone is removed at Ever Platform, then each Ever ID not reported yet (or reported with another
   * tenant link) is reported, while the integration allows it. A call that fails is tried again an hour later, so other
   * links go first meanwhile. Calls nothing while there is nothing to tell.
   */
  /**
   * `keepLease` is asked before each call to Ever Platform (the scheduler renews its lease there): once it answers
   * false, another API process holds the background calls and this round stops.
   */
  async syncLinks(now = Date.now(), force = false, keepLease?: () => Promise<boolean>): Promise<{ reported: number; removed: number }> {
    if (!force && !this.syncRequested && now - this.lastSyncAt < PERSON_LINK_SYNC_MS) {
      return { reported: 0, removed: 0 };
    }
    this.syncRequested = false;
    this.lastSyncAt = now;
    const live = await this.connect.liveClient();
    if (!live || live.connection.status !== 'active') {
      return { reported: 0, removed: 0 };
    }
    const { client, connection } = live;
    const identities = (await this.identityRows()).filter(EverConnectPersonService.reportable);
    const byId = new Map(identities.map(identity => [identity.id, identity]));
    const waiting = (row: EverConnectPersonLink | undefined) => !!row && !!row.retryAt && row.retryAt > now;
    // Only for the connection that made the call (a disconnect meanwhile deleted every link)
    const later = (row: Partial<EverConnectPersonLink>) =>
      this.saveIfConnected(connection.kid, Object.assign(new EverConnectPersonLink(), row, { retryAt: now + PERSON_LINK_RETRY_MS, updatedAt: now }));
    let calls = 0;
    let removed = 0;
    let reported = 0;

    // Removals first: a removal names the user, so a link reported for the same user afterwards is not removed with it
    let leaseLost = false;
    const leaseHeld = async (): Promise<boolean> => {
      if (!keepLease || (await keepLease())) return true;
      leaseLost = true;
      return false;
    };
    for (const row of await this.links.find()) {
      if (byId.has(row.userIdentityId) || waiting(row) || calls >= PERSON_LINK_CALLS_PER_SYNC) continue;
      if (!(await leaseHeld())) break;
      calls += 1;
      try {
        await client.removePersonLink(row.userId);
      } catch (error) {
        const problem = problemOf(error);
        if (!problem || problem.status !== 404) {
          await this.connect.handleCallError(error, 'person_link_remove', connection.kid);
          await later(row);
          continue;
        }
      }
      await this.links.delete({ userIdentityId: row.userIdentityId });
      await this.links.update({ userId: row.userId, userIdentityId: Not(row.userIdentityId) }, { reportedAt: null, updatedAt: now });
      removed += 1;
    }

    if (leaseLost) {
      return { reported, removed };
    }
    if (!(await this.reporting())) {
      // Nothing is reported while the integration is off; once it is on again, every link is reported again
      await this.links.update({ reportedAt: Not(IsNull()) }, { reportedAt: null, tenantLinkId: null, updatedAt: now });
    } else {
      const known = new Map((await this.links.find()).map(row => [row.userIdentityId, row]));
      const linkActive = connection.linkState === 'active' && !!connection.linkId;
      const tenantLinkId = linkActive ? connection.linkId : null;
      for (const identity of identities) {
        const row = known.get(identity.id);
        const current = !!row && !!row.reportedAt && row.tenantLinkId === tenantLinkId;
        if (current || waiting(row) || calls >= PERSON_LINK_CALLS_PER_SYNC) continue;
        if (!(await leaseHeld())) break;
        // Checked again before each report (after the lease renewal): once the integration is switched off here, no
        // further report starts
        if (!(await this.reporting())) break;
        calls += 1;
        try {
          await client.reportPersonLink({
            productUserRef: identity.userId,
            identityIssuer: identity.issuer,
            identitySubject: identity.subject,
            linkMethod: identity.linkMethod === IdentityLinkMethod.Jit ? 'confirmed' : 'explicit',
            // One tenant for the whole installation, and its link with the organization while it is active
            ...(linkActive ? { productTenantId: '*', tenantLinkId } : {}),
            ...(linkActive && connection.displayName ? { displayName: connection.displayName } : {}),
          });
        } catch (error) {
          await this.connect.handleCallError(error, 'person_link_report', connection.kid);
          await later({
            userIdentityId: identity.id,
            userId: identity.userId,
            reportedAt: row ? row.reportedAt : null,
            tenantLinkId: row ? row.tenantLinkId : null,
          });
          continue;
        }
        const saved = await this.saveIfConnected(
          connection.kid,
          Object.assign(new EverConnectPersonLink(), {
            userIdentityId: identity.id,
            userId: identity.userId,
            reportedAt: now,
            tenantLinkId,
            retryAt: null,
            updatedAt: now,
          }),
        );
        if (!saved) {
          // The connection ended meanwhile (and with it every link): a later connection reports this one again
          break;
        }
        reported += 1;
      }
    }
    if (calls >= PERSON_LINK_CALLS_PER_SYNC) {
      // More to tell: the next round goes on
      this.syncRequested = true;
    }
    if (reported || removed) {
      await this.audit.record('person_link.sync', 'system', `reported=${reported} removed=${removed}`);
    }
    return { reported, removed };
  }
}
