import { HttpStatus, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  createManagedOperationRunner,
  ManagedOperation,
  ManagedOperationExecutor,
  ManagedOperationKind,
  ManagedOperationOutcome,
} from '@ever-co/connect-sdk';
import { createHash, randomBytes } from 'crypto';
import { createReadStream, promises as fs } from 'fs';
import { isAbsolute, join } from 'path';
import { In, IsNull, LessThanOrEqual, Not, Repository } from 'typeorm';
import { EverConnectIntegration } from '../entity/ever-connect-integration.entity';
import { EverConnectManagedOperation } from '../entity/ever-connect-managed-operation.entity';
import { EverConnectManagedPolicy } from '../entity/ever-connect-managed-policy.entity';
import { EverPlatformException } from '../errors';
import { EVER_INSTANCE_SETTINGS, EverInstanceSettings } from '../ever-instance/ever-instance.settings';
import { KeyPurpose, unwrapKey, wrapKey } from '../ever-instance/key-wrap';
import { DbType } from '../utils/database-type-helper';
import { EverConnectAuditService } from './ever-connect-audit.service';
import { EverConnectPlatformClient, ManagedResult, PlatformEvent, problemOf } from './ever-connect-platform.client';
import { EVER_CONNECT_SETTINGS, EverConnectSettings } from './ever-connect.settings';

/** The feed event of a requested maintenance operation. */
export const MANAGED_REQUESTED_TYPE = 'ever.registry.managed_operation.requested';

/**
 * What Traduora runs from inside its container. `update` is never one: the API cannot replace its own image (the
 * operator updates the container). `backup` and `restore_check` only on SQLite, whose online backup is a consistent copy
 * of one file; PostgreSQL and MySQL need their own dump tools, which the image does not ship.
 */
export function supportedKinds(dbType: string): ManagedOperationKind[] {
  return dbType === DbType.BETTER_SQLITE3 ? ['health_report', 'backup', 'restore_check'] : ['health_report'];
}

/** Why a kind cannot run here at all, for the log and the history. */
export function unsupportedReason(kind: string, dbType: string): string {
  if (kind === 'update') return 'update_not_supported';
  if (kind === 'backup' || kind === 'restore_check') return dbType === DbType.BETTER_SQLITE3 ? 'kind_not_supported' : 'unsupported_dialect';
  return 'kind_not_supported';
}

/** A weekly window in UTC: the days (0 = Sunday) and the hours `from` to `to` (`HH:MM`); `to` before `from` is overnight. */
export interface ManagedWindow {
  days: number[];
  from: string;
  to: string;
}

/** What the operator sees and sets (the backup directory only as set or not). */
export interface ManagedView {
  available: boolean;
  optIn: boolean;
  kinds: string[];
  supportedKinds: string[];
  windows: ManagedWindow[];
  backupDirSet: boolean;
  history: Array<{ operationId: string; kind: string; status: string; reason: string | null; sizeBytes: number | null; at: number }>;
}

const POLICY_ID = 'self';
const HISTORY_KEPT = 50;
/** A run still `running` after this long was interrupted (the process stopped): it is answered `failed`. */
const RUNNING_STALE_MS = 6 * 60 * 60 * 1000;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const OPERATION_ID = /^[0-9A-Za-z_-]{1,64}$/;
const BACKUP_NAME = /^bk-\d{8}T\d{6}Z-[0-9a-f]{6}$/;

/** The backup directory is encrypted for its own purpose. */
const BACKUP_DIR_PURPOSE: KeyPurpose = { info: 'ever-connect/managed-backup-dir', aad: 'ever_connect:managed_backup_dir' };

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether `at` (epoch ms) falls in one of the windows (UTC). */
export function inWindow(windows: ManagedWindow[], at: number): boolean {
  const date = new Date(at);
  const day = date.getUTCDay();
  const yesterday = (day + 6) % 7;
  const now = date.getUTCHours() * 60 + date.getUTCMinutes();
  return windows.some(window => {
    const from = minutes(window.from);
    const to = minutes(window.to);
    if (from <= to) return window.days.includes(day) && now >= from && now < to;
    // Overnight: the late part belongs to the chosen day, the early part to the day after it
    return (window.days.includes(day) && now >= from) || (window.days.includes(yesterday) && now < to);
  });
}

const parseList = <T>(text: string | null): T[] => {
  try {
    const value = text ? JSON.parse(text) : [];
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

/** Whether a database error is a unique or primary key violation (PostgreSQL, MySQL, SQLite). */
function isDuplicateKey(error: unknown): boolean {
  const record = error as { code?: unknown; driverError?: { code?: unknown }; message?: unknown } | null;
  const code = record && (record.code || (record.driverError && record.driverError.code));
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (!!record && typeof record.message === 'string' && record.message.includes('UNIQUE constraint failed'))
  );
}

/** The size and SHA-256 of a file, read as a stream (a backup can be larger than the memory the API may use). */
function digest(file: string): Promise<{ size: number; sha256: string }> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    let size = 0;
    createReadStream(file)
      .on('data', (chunk: Buffer) => {
        hash.update(chunk);
        size += chunk.length;
      })
      .on('error', reject)
      .on('end', () => resolve({ size, sha256: hash.digest('hex') }));
  });
}

const invalid = (message: string) => new EverPlatformException(HttpStatus.BAD_REQUEST, 'invalid_managed', message);

/**
 * Maintenance operations an owner or admin of the organization requests in app.ever.co for this self-hosted
 * installation: a health report, a backup of the SQLite database to the operator's own directory, and a check of a
 * backup. One runs only when the organization enabled `managed_operations` **and** the operator opted in here, for a
 * kind the operator allows, inside one of the operator's windows; otherwise the answer is `failed` and nothing else
 * happens. Ever Platform receives the status, the version and sizes only (never a path or a file name). The
 * Ever-operated cloud is not a target: Ever operates it.
 */
@Injectable()
export class EverConnectManagedService {
  private readonly logger = new Logger(EverConnectManagedService.name);
  private readonly dbType: string;
  /** The result the runner decided for the operation it is running (this module sends it, so a failed send is retried). */
  private decided: ManagedResult | null = null;
  /** The time the operation runs at (the runner checks the start and expiry times against it). */
  private runAt: number | null = null;
  private readonly runner = createManagedOperationRunner({
    executor: this.executor(),
    postResult: async (_operationId, result) => {
      this.decided = result as ManagedResult;
    },
    now: () => Math.floor((this.runAt === null ? Date.now() : this.runAt) / 1000),
  });

  constructor(
    @InjectRepository(EverConnectManagedPolicy) private readonly policies: Repository<EverConnectManagedPolicy>,
    @InjectRepository(EverConnectManagedOperation) private readonly operations: Repository<EverConnectManagedOperation>,
    @InjectRepository(EverConnectIntegration) private readonly integrationRows: Repository<EverConnectIntegration>,
    @Inject(EVER_CONNECT_SETTINGS) private readonly settings: EverConnectSettings,
    @Inject(EVER_INSTANCE_SETTINGS) private readonly instanceSettings: EverInstanceSettings,
    private readonly audit: EverConnectAuditService,
  ) {
    // The database this API is connected to (what a backup can copy), read from its own connection
    this.dbType = String(policies.manager.connection.options.type);
  }

  private policy(): Promise<EverConnectManagedPolicy | null> {
    return this.policies.findOne({ where: { id: POLICY_ID } });
  }

  private ensureAvailable(): void {
    if (this.settings.installSource === 'cloud') {
      throw new NotFoundException();
    }
  }

  // The operator's opt-in

  /** What the operator sees: the opt-in, kinds, windows, whether a backup directory is set, and the history. */
  async view(): Promise<ManagedView> {
    this.ensureAvailable();
    const policy = await this.policy();
    const history = await this.operations.find({ order: { at: 'DESC' }, take: HISTORY_KEPT });
    return {
      available: true,
      optIn: !!policy && policy.optIn === true,
      kinds: parseList<string>(policy ? policy.kinds : null),
      supportedKinds: supportedKinds(this.dbType),
      windows: parseList<ManagedWindow>(policy ? policy.windows : null),
      backupDirSet: !!policy && !!policy.backupDirEnc,
      history: history.map(row => ({
        operationId: row.operationId,
        kind: row.kind,
        status: row.status,
        reason: row.reason,
        sizeBytes: row.sizeBytes,
        at: row.at,
      })),
    };
  }

  /** Sets the opt-in, the allowed kinds, the windows and (write-only) the backup directory. */
  async update(body: { optIn?: unknown; kinds?: unknown; windows?: unknown; backupDir?: unknown }, actorRef: string): Promise<ManagedView> {
    this.ensureAvailable();
    // The fields not given keep their current value, read under a lock: a concurrent change is never written back over
    let previousOptIn = false;
    let optIn = false;
    let kindsSaved: string[] = [];
    let windowCount = 0;
    await this.policies.manager.transaction(async manager => {
      const previous = await manager.findOne(EverConnectManagedPolicy, {
        where: { id: POLICY_ID },
        ...(this.dbType === DbType.BETTER_SQLITE3 ? {} : { lock: { mode: 'pessimistic_write' as const } }),
      });
      const saved = this.merge(previous, body, actorRef);
      await manager.save(saved);
      previousOptIn = !!previous && previous.optIn === true;
      optIn = saved.optIn;
      kindsSaved = parseList<string>(saved.kinds);
      windowCount = parseList<ManagedWindow>(saved.windows).length;
    });
    if (optIn !== previousOptIn) {
      await this.audit.record(optIn ? 'managed.opt_in' : 'managed.opt_out', actorRef, null);
    } else {
      await this.audit.record('managed.policy', actorRef, `kinds=${kindsSaved.join('+') || 'none'} windows=${windowCount}`);
    }
    return this.view();
  }

  /** The policy row after `body` is applied to `previous` (checked; the backup directory encrypted). */
  private merge(
    previous: EverConnectManagedPolicy | null,
    body: { optIn?: unknown; kinds?: unknown; windows?: unknown; backupDir?: unknown },
    actorRef: string,
  ): EverConnectManagedPolicy {
    const supported = supportedKinds(this.dbType) as string[];
    const kinds = Array.isArray(body.kinds) ? body.kinds : parseList<string>(previous ? previous.kinds : null);
    if (!kinds.every(kind => typeof kind === 'string' && supported.includes(kind))) {
      throw invalid(`The kinds this installation runs are ${supported.join(', ')}`);
    }
    const windows = Array.isArray(body.windows) ? body.windows : parseList<ManagedWindow>(previous ? previous.windows : null);
    for (const window of windows) {
      const valid =
        !!window &&
        Array.isArray(window.days) &&
        window.days.length > 0 &&
        window.days.every((day: unknown) => Number.isInteger(day) && (day as number) >= 0 && (day as number) <= 6) &&
        typeof window.from === 'string' &&
        typeof window.to === 'string' &&
        HHMM.test(window.from) &&
        HHMM.test(window.to) &&
        window.from !== window.to;
      if (!valid) {
        throw invalid('A window is {days: [0-6], from: "HH:MM", to: "HH:MM"} in UTC');
      }
    }
    let backupDirEnc = previous ? previous.backupDirEnc : null;
    if (typeof body.backupDir === 'string') {
      const dir = body.backupDir.trim();
      if (dir && (!isAbsolute(dir) || dir.length > 1024)) {
        throw invalid('The backup directory is an absolute path');
      }
      backupDirEnc = dir ? wrapKey(Buffer.from(dir, 'utf8'), this.instanceSettings.secret, POLICY_ID, BACKUP_DIR_PURPOSE) : null;
    }
    return Object.assign(new EverConnectManagedPolicy(), {
      id: POLICY_ID,
      optIn: typeof body.optIn === 'boolean' ? body.optIn : !!previous && previous.optIn === true,
      kinds: JSON.stringify(kinds),
      windows: JSON.stringify(windows.map((window: ManagedWindow) => ({ days: [...window.days], from: window.from, to: window.to }))),
      backupDirEnc,
      updatedAt: Date.now(),
      updatedBy: actorRef,
    });
  }

  private async backupDir(): Promise<string | null> {
    const policy = await this.policy();
    if (!policy || !policy.backupDirEnc) return null;
    try {
      return unwrapKey(policy.backupDirEnc, this.instanceSettings.secret, POLICY_ID, BACKUP_DIR_PURPOSE).toString('utf8');
    } catch {
      return null;
    }
  }

  /** Why an operation may not run now, or `null` when it may. */
  async refusal(kind: string, now = Date.now()): Promise<string | null> {
    if (this.settings.installSource === 'cloud') return 'operated_by_ever';
    if (this.settings.integrationsDeny.includes('managed_operations')) return 'denied_by_policy';
    const consent = await this.integrationRows.findOne({ where: { key: 'managed_operations' } });
    if (!consent || consent.state !== 'enabled' || consent.pendingRemoteRevoke) return 'no_consent';
    const policy = await this.policy();
    if (!policy || !policy.optIn) return 'no_operator_opt_in';
    if (!(supportedKinds(this.dbType) as string[]).includes(kind)) return unsupportedReason(kind, this.dbType);
    if (!parseList<string>(policy.kinds).includes(kind)) return 'kind_not_allowed';
    if (!inWindow(parseList<ManagedWindow>(policy.windows), now)) return 'outside_window';
    return null;
  }

  // Requests from the feed

  /** The maintenance requests of a feed page. Throws when a result could not be sent: the page is read again. */
  async handleEvents(
    client: EverConnectPlatformClient,
    events: ReadonlyArray<PlatformEvent>,
    connectionKid: string | null,
    stillCurrent: () => Promise<boolean> = async () => true,
  ): Promise<void> {
    for (const event of events) {
      if (event.type === MANAGED_REQUESTED_TYPE) {
        // The connection that received the request must still be the active one when it starts
        if (!(await stillCurrent())) return;
        await this.handle(client, event.data || {}, connectionKid);
      }
    }
  }

  /**
   * One requested operation. A request with a later start time waits (its checks run when it starts). Otherwise it is
   * claimed first (one API process runs it), then refused or run through the SDK runner.
   */
  async handle(client: EverConnectPlatformClient, data: Record<string, unknown>, connectionKid: string | null, now = Date.now()): Promise<void> {
    const operationId = typeof data.operation_id === 'string' && OPERATION_ID.test(data.operation_id) ? data.operation_id : null;
    const kind = typeof data.kind === 'string' ? data.kind.slice(0, 24) : '';
    if (!operationId) {
      this.logger.warn('ever_connect.managed outcome=ignored reason=no_operation_id');
      return;
    }
    const known = await this.operations.findOne({ where: { operationId } });
    if (known && known.unsentResult) {
      await this.deliver(client, known);
      return;
    }
    if (known && (known.status !== 'deferred' || (known.notBefore || 0) > now)) {
      return;
    }
    const row = Object.assign(new EverConnectManagedOperation(), {
      operationId,
      kind,
      status: 'running',
      reason: null,
      sizeBytes: null,
      request: null,
      unsentResult: null,
      connectionKid,
      notBefore: null,
      at: now,
    });
    const notBefore = Date.parse(String(data.not_before));
    if (!known && !Number.isNaN(notBefore) && notBefore > now) {
      // Not yet: it waits, and the consent, opt-in and window are checked when it starts
      await this.remember(Object.assign(row, { status: 'deferred', request: JSON.stringify(data), notBefore }));
      return;
    }
    if (!(await this.claim(row, !!known))) {
      return;
    }
    const refusal = await this.refusal(kind, now);
    if (refusal) {
      row.status = 'refused';
      row.reason = refusal;
      // Audited with the outcome, whether or not Ever Platform receives it at once
      await this.store(row, { status: 'failed' });
      // Audited with the outcome, before Ever Platform is told (a failed send is retried from the stored result)
      await this.audit.record('managed.refused', 'platform', `kind=${kind} reason=${refusal}`);
      await this.deliver(client, row);
      this.logger.log(`ever_connect.managed kind=${kind} outcome=refused reason=${refusal}`);
      return;
    }
    this.decided = null;
    this.runAt = now;
    let report;
    try {
      report = await this.runner.handle({ type: MANAGED_REQUESTED_TYPE, data } as never);
    } finally {
      this.runAt = null;
    }
    const result = this.decided as ManagedResult | null;
    this.decided = null;
    row.status = result && result.status === 'succeeded' ? 'succeeded' : 'failed';
    row.reason = row.status === 'succeeded' ? null : report.outcome;
    row.sizeBytes = result && typeof result.size_bytes === 'number' ? result.size_bytes : null;
    // The outcome is stored first: whatever fails after this, the result is never lost and the work never runs again
    if (result) {
      await this.store(row, result);
    } else {
      // Expired (Ever Platform expired it) or a repeated delivery: nothing to send
      await this.remember(row);
    }
    const reasonText = row.reason ? ` reason=${row.reason}` : '';
    await this.audit.record('managed.result', 'platform', `kind=${kind} status=${row.status}${reasonText}`);
    this.logger.log(`ever_connect.managed kind=${kind} outcome=${report.outcome}`);
    if (result) {
      await this.deliver(client, row);
    }
  }

  /**
   * Claims an operation for this process: a new one is inserted as `running` (the id is unique), a deferred one moves
   * from `deferred` to `running`. Another API process that read the same request finds it claimed and leaves it.
   */
  private async claim(row: EverConnectManagedOperation, wasDeferred: boolean): Promise<boolean> {
    if (wasDeferred) {
      const result = await this.operations.update(
        { operationId: row.operationId, status: 'deferred' },
        { status: 'running', request: null, notBefore: null, at: row.at, connectionKid: row.connectionKid },
      );
      return result.affected === undefined || result.affected === null || result.affected === 1;
    }
    try {
      await this.operations.insert(row);
      return true;
    } catch (error) {
      // Another API process claimed it; any other error is thrown, so the feed page is read again
      if (isDuplicateKey(error)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Runs the deferred operations whose start time came, and sends the results not received yet (each scheduler round),
   * for the current connection only: work received by an ended connection is cancelled, never run or sent through
   * another one. A result Ever Platform cannot take now waits for the next round without holding back due work.
   */
  async runDue(
    client: EverConnectPlatformClient,
    connectionKid: string | null,
    now = Date.now(),
    stillCurrent: () => Promise<boolean> = async () => true,
  ): Promise<number> {
    if (connectionKid) {
      await this.operations.update(
        { connectionKid: Not(connectionKid), status: 'deferred' },
        { status: 'failed', reason: 'connection_ended', request: null, notBefore: null },
      );
      await this.operations.update({ connectionKid: Not(connectionKid), unsentResult: Not(IsNull()) }, { unsentResult: null });
    }
    // A run interrupted (the process stopped) is answered `failed` rather than run twice
    await this.operations.update(
      { status: 'running', at: LessThanOrEqual(now - RUNNING_STALE_MS), connectionKid },
      { status: 'failed', reason: 'interrupted', unsentResult: JSON.stringify({ status: 'failed' }) },
    );
    for (const row of await this.operations.find({ where: { unsentResult: Not(IsNull()), connectionKid } })) {
      // Before each send, as before each due run: once another process holds the lease (or the connection changed), it
      // sends the rest and runs the due work
      if (!(await stillCurrent())) return 0;
      try {
        await this.deliver(client, row);
      } catch (error) {
        const problem = problemOf(error);
        if (problem && problem.status === 401) {
          throw error;
        }
        this.logger.warn(`ever_connect.managed result=retry_later reason=${problem ? `${problem.status}:${problem.code}` : 'unreachable'}`);
      }
    }
    const due = await this.operations.find({
      where: { status: 'deferred', notBefore: LessThanOrEqual(now), request: Not(IsNull()), connectionKid },
    });
    for (const row of due) {
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(row.request);
      } catch {
        await this.operations.update({ operationId: row.operationId }, { status: 'failed', reason: 'request_unreadable', request: null });
        continue;
      }
      // The connection must still be the active one, and each starts at its own time (an earlier one may have taken a while)
      if (!(await stillCurrent())) break;
      await this.handle(client, data, connectionKid, Math.max(now, Date.now()));
    }
    return due.length;
  }

  /** Records the operation with its result, still to be sent. */
  private async store(row: EverConnectManagedOperation, result: ManagedResult): Promise<void> {
    row.request = null;
    row.notBefore = null;
    row.unsentResult = JSON.stringify(result);
    await this.remember(row);
  }

  /**
   * Sends a stored result. One Ever Platform no longer wants (already recorded, expired, unknown) is not sent again; a
   * failed send (no connection, a busy or failing platform) throws and is tried again.
   */
  private async deliver(client: EverConnectPlatformClient, row: EverConnectManagedOperation): Promise<void> {
    let result: ManagedResult;
    try {
      result = JSON.parse(row.unsentResult);
    } catch {
      result = { status: 'failed' };
    }
    try {
      await client.managedOperationResult(row.operationId, result);
    } catch (error) {
      const problem = problemOf(error);
      if (!problem || problem.status === 401 || problem.status === 429 || problem.status >= 500) {
        throw error;
      }
      this.logger.warn(`ever_connect.managed result=not_needed reason=${problem.status}:${problem.code}`);
    }
    await this.operations.update({ operationId: row.operationId }, { unsentResult: null });
    await this.prune();
  }

  /** Records an operation, keeping the last 50. */
  private async remember(row: Omit<EverConnectManagedOperation, never>): Promise<void> {
    await this.operations.save(Object.assign(new EverConnectManagedOperation(), row));
    await this.prune();
  }

  /** Keeps the last 50 finished operations (waiting, running and unsent ones are never dropped). */
  private async prune(): Promise<void> {
    const stale = await this.operations.find({
      select: { operationId: true },
      where: { status: Not(In(['deferred', 'running'])), unsentResult: IsNull() },
      order: { at: 'DESC' },
      skip: HISTORY_KEPT,
      take: 100,
    });
    if (stale.length) {
      await this.operations.delete(stale.map(old => old.operationId));
    }
  }

  // The work

  private executor(): ManagedOperationExecutor {
    return {
      kinds: () => supportedKinds(this.dbType),
      dryRun: async (op: ManagedOperation) => {
        if (op.kind === 'health_report') return { ok: true };
        const dir = await this.backupDir();
        if (!dir) return { ok: false, reason: 'no_backup_directory' };
        try {
          await fs.mkdir(dir, { recursive: true, mode: 0o700 });
          await fs.access(dir);
          return { ok: true };
        } catch {
          return { ok: false, reason: 'backup_directory_unwritable' };
        }
      },
      // Never called: `update` is not a kind this installation runs
      backupBeforeUpdate: async () => ({ ok: false }),
      execute: async (op: ManagedOperation): Promise<ManagedOperationOutcome> => {
        if (op.kind === 'health_report') return this.health();
        if (op.kind === 'backup') return this.backup();
        if (op.kind === 'restore_check') {
          const params = (op as { params?: { artefact_ref?: unknown } }).params || {};
          return this.restoreCheck(typeof params.artefact_ref === 'string' ? params.artefact_ref : null);
        }
        return { status: 'failed' };
      },
    };
  }

  /** The API answers and its database is reachable. */
  private async health(): Promise<ManagedOperationOutcome> {
    try {
      await this.policies.query('SELECT 1');
      return { status: 'succeeded', version: this.settings.version };
    } catch {
      this.logger.warn('ever_connect.managed health=database_unreachable');
      return { status: 'failed', version: this.settings.version };
    }
  }

  /** The SQLite online backup (a consistent copy while the API keeps running), and a manifest with its SHA-256. */
  private async backup(): Promise<ManagedOperationOutcome> {
    const dir = await this.backupDir();
    const sqlite = (this.policies.manager.connection.driver as unknown as { databaseConnection?: { backup?: (file: string) => Promise<unknown> } })
      .databaseConnection;
    if (!dir || !sqlite || typeof sqlite.backup !== 'function') return { status: 'failed' };
    const stamp = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}/, '');
    const ref = `bk-${stamp}-${randomBytes(3).toString('hex')}`;
    const file = join(dir, `${ref}.sqlite3`);
    const manifestFile = join(dir, `${ref}.manifest.json`);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    // The file exists, readable by this user only, before any data goes into it
    await (await fs.open(file, 'wx', 0o600)).close();
    const created = [file];
    try {
      await fs.chmod(file, 0o600);
      await sqlite.backup(file);
      const { size, sha256 } = await digest(file);
      created.push(manifestFile);
      await fs.writeFile(manifestFile, JSON.stringify({ ref, createdAt: Date.now(), sizeBytes: size, sha256 }), { mode: 0o600, flag: 'wx' });
      return { status: 'succeeded', artefact_ref: ref, size_bytes: size };
    } catch (error) {
      // An incomplete backup leaves nothing behind (only the files this attempt created)
      await Promise.all(created.map(path => fs.rm(path, { force: true }).catch(() => undefined)));
      throw error;
    }
  }

  /** A backup (the one named, else the newest) still matches its manifest. */
  private async restoreCheck(wanted: string | null): Promise<ManagedOperationOutcome> {
    const dir = await this.backupDir();
    if (!dir) return { status: 'failed' };
    try {
      let manifest: { ref: string; createdAt: number; sizeBytes: number; sha256: string } | null = null;
      for (const name of await fs.readdir(dir)) {
        const match = /^(bk-.+)\.manifest\.json$/.exec(name);
        if (!match || !BACKUP_NAME.test(match[1]) || (wanted && match[1] !== wanted)) continue;
        let candidate: { ref?: unknown; createdAt?: unknown; sizeBytes: number; sha256: string } | null = null;
        try {
          candidate = JSON.parse(await fs.readFile(join(dir, name), 'utf8'));
        } catch {
          // The named backup's damaged manifest fails the check; an older damaged one does not decide a check of the newest
          if (wanted) return { status: 'failed', artefact_ref: wanted };
          continue;
        }
        if (candidate && candidate.ref === match[1] && (!manifest || Number(candidate.createdAt) > Number(manifest.createdAt))) {
          manifest = candidate as { ref: string; createdAt: number; sizeBytes: number; sha256: string };
        }
      }
      if (!manifest) return { status: 'failed' };
      const { size, sha256 } = await digest(join(dir, `${manifest.ref}.sqlite3`));
      const ok = size === manifest.sizeBytes && sha256 === manifest.sha256;
      return ok ? { status: 'succeeded', artefact_ref: manifest.ref, size_bytes: size } : { status: 'failed', artefact_ref: manifest.ref };
    } catch {
      return { status: 'failed' };
    }
  }
}
