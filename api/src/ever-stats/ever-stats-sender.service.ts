import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import * as http from 'http';
import * as https from 'https';
import { In, Repository } from 'typeorm';
import { usableEverApiUrl } from '../config';
import { EverStatsReport, EverStatsReportStatus } from '../entity/ever-stats-report.entity';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EverInstanceKeyError } from '../ever-instance/key-wrap';
import { EVER_STATS_CLOCK, EverStatsClock } from './ever-stats.clock';
import { CONTRACTS_VERSION, PRODUCT, STATS_HEADERS, STATS_REPORTS_KEPT, STATS_REPORTS_PATH, STATS_SEND_TIMEOUT_MS } from './ever-stats.constants';
import { EVER_STATS_SETTINGS, EverStatsSettings } from './ever-stats.settings';
import { EverStatsCollectorService } from './ever-stats-collector.service';
import { signStatsReport } from './ever-stats-signer';

/** The HTTP client of the module, replaced in tests: one request, its status, nothing else. */
export type StatsFetch = (url: string, init: { method: string; headers: Record<string, string>; body: Buffer }) => Promise<{ status: number }>;

export const EVER_STATS_FETCH = Symbol('ever stats fetch');

/**
 * Posts with Node's own `http`/`https` client: no redirect is ever followed (the client does not follow them), no
 * cookie jar, no proxy, no connection reuse, and the whole exchange is cut after 10 seconds. The answer's body is not
 * read.
 */
export const defaultStatsFetch: StatsFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
    let deadline: NodeJS.Timeout;
    const request = client.request(
      target,
      {
        method: init.method,
        headers: { ...init.headers, 'Content-Length': String(init.body.length) },
        agent: false,
        timeout: STATS_SEND_TIMEOUT_MS,
      },
      response => {
        clearTimeout(deadline);
        response.resume();
        resolve({ status: response.statusCode ?? 0 });
      },
    );
    deadline = setTimeout(() => request.destroy(new Error('timeout')), STATS_SEND_TIMEOUT_MS);
    deadline.unref?.();
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => {
      clearTimeout(deadline);
      reject(error);
    });
    request.end(init.body);
  });

/** What happens after an attempt. */
export type StatsRetry = 'none' | 'backoff' | 'next_day' | 'module_upgrade';

/** One attempt: the stored row and what to do next. */
export interface StatsSendResult {
  row: EverStatsReport;
  retry: StatsRetry;
}

/** How Ever Platform's answer is recorded. */
export function classifyAnswer(httpStatus: number | null): { status: EverStatsReportStatus; retry: StatsRetry; hint: string | null } {
  if (httpStatus !== null && httpStatus >= 200 && httpStatus < 300) {
    return { status: 'sent', retry: 'none', hint: null };
  }
  if (httpStatus === 422) {
    return { status: 'rejected', retry: 'module_upgrade', hint: null };
  }
  if (httpStatus === 409) {
    return { status: 'rejected', retry: 'next_day', hint: 'reset_identity' };
  }
  if (httpStatus === null || httpStatus === 429 || httpStatus >= 500) {
    return { status: 'failed', retry: 'backoff', hint: null };
  }
  return { status: 'failed', retry: 'next_day', hint: null };
}

/**
 * Signs and sends one report. The report is serialised once; those exact bytes are signed with the installation's
 * statistics key, stored, and posted unchanged: `POST {apiUrl}/v1/stats/reports`, with the public key and the
 * signature in the headers, no cookie, no credential, no redirect followed, within 10 seconds (see
 * {@link defaultStatsFetch}). This is the only request the module makes.
 */
@Injectable()
export class EverStatsSenderService {
  private readonly logger = new Logger('EverStats');

  constructor(
    @InjectRepository(EverStatsReport) private readonly reportsRepo: Repository<EverStatsReport>,
    @Inject(EVER_STATS_SETTINGS) private readonly settings: EverStatsSettings,
    @Inject(EVER_STATS_CLOCK) private readonly clock: EverStatsClock,
    @Inject(EVER_STATS_FETCH) private readonly fetchFn: StatsFetch,
    private readonly instance: EverInstanceService,
    private readonly collector: EverStatsCollectorService,
  ) {}

  /** The `User-Agent` of a report: `ever-connect-sdk/<contract version> (traduora/<version>)`. */
  userAgent(): string {
    return `ever-connect-sdk/${CONTRACTS_VERSION} (${PRODUCT}/${this.settings.release.version})`;
  }

  private newRow(fields: Partial<EverStatsReport> & Pick<EverStatsReport, 'id' | 'instanceId' | 'period' | 'final' | 'status'>): EverStatsReport {
    return Object.assign(new EverStatsReport(), {
      payload: '',
      signature: '',
      sentAt: null,
      httpStatus: null,
      attempts: 0,
      nextAttemptAt: null,
      error: null,
      hint: null,
      createdAt: new Date(this.clock()),
      ...fields,
    });
  }

  /** Builds, checks, signs, stores and sends the report of `period`. */
  async send(input: { period: string; final: boolean }): Promise<StatsSendResult> {
    const now = this.clock();
    let identity: Awaited<ReturnType<EverInstanceService['signingIdentity']>>;
    try {
      identity = await this.instance.signingIdentity();
    } catch (error) {
      const code = error instanceof EverInstanceKeyError ? error.code : 'identity_unavailable';
      this.logger.warn(`ever_stats.send outcome=failed reason=${code} final=${input.final}`);
      const record = await this.instance.read().catch((): null => null);
      const row = this.newRow({
        id: randomUUID(),
        instanceId: record?.instanceId ?? '',
        period: input.period,
        final: input.final,
        status: 'failed',
        error: code === 'secret_missing' ? 'secret_missing' : code === 'identity_unavailable' ? code : 'key_unreadable',
        hint: code === 'secret_missing' ? 'set_secret' : code === 'identity_unavailable' ? null : 'reset_identity',
      });
      if (record) {
        await this.insertFor(record.instanceId, row);
      }
      return { row, retry: 'next_day' };
    }

    const instanceId = identity.record.instanceId;
    const built = await this.collector.build({ instanceId, period: input.period, final: input.final, now });
    const reportId = String(built.report.report_id);
    if (built.error) {
      this.logger.warn(`ever_stats.schema_violation ${built.error} final=${input.final}`);
      const row = this.newRow({ id: reportId, instanceId, period: input.period, final: input.final, payload: built.text, status: 'rejected', error: built.error });
      await this.insertFor(instanceId, row);
      return { row, retry: 'module_upgrade' };
    }

    const signature = signStatsReport(identity.privateKeyDer, built.bytes);
    const row = this.newRow({ id: reportId, instanceId, period: input.period, final: input.final, payload: built.text, signature, status: 'pending', attempts: 1 });
    // Stored before the request, so the exact bytes are on record whatever happens next
    await this.insertFor(instanceId, row);

    const apiUrl = this.settings.apiUrl ? usableEverApiUrl(this.settings.apiUrl) : null;
    if (!apiUrl) {
      this.logger.warn(`ever_stats.url_insecure outcome=failed final=${input.final}`);
      Object.assign(row, { status: 'failed', error: 'api_url_unusable' });
      await this.updateFor(instanceId, row);
      return { row, retry: 'next_day' };
    }

    let httpStatus: number | null = null;
    try {
      const response = await this.fetchFn(`${apiUrl}${STATS_REPORTS_PATH}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': this.userAgent(),
          [STATS_HEADERS.key]: identity.record.statsPublicKey,
          [STATS_HEADERS.signature]: signature,
          [STATS_HEADERS.keyId]: identity.record.statsKeyId,
        },
        body: built.bytes,
      });
      httpStatus = response.status;
    } catch {
      httpStatus = null;
    }

    const outcome = classifyAnswer(httpStatus);
    this.logger.log(`ever_stats.send outcome=${outcome.status} status=${httpStatus ?? 'connection_error'} final=${input.final}`);
    Object.assign(row, {
      sentAt: outcome.status === 'sent' ? new Date(this.clock()) : null,
      httpStatus,
      status: outcome.status,
      error: httpStatus === null ? 'connection_error' : outcome.status === 'sent' ? null : `http_${httpStatus}`,
      hint: outcome.hint,
    });
    await this.updateFor(instanceId, row);
    return { row, retry: outcome.retry };
  }

  /** Whether the installation still has the identity `instanceId` (a reset makes a new one). */
  private async identityIs(instanceId: string): Promise<boolean> {
    const current = await this.instance.read();
    return current?.instanceId === instanceId;
  }

  /**
   * Writes the row of a report built for `instanceId`, unless the identity was reset meanwhile: a reset clears the
   * history, and a report of the old identity that finishes later must not write itself back into it. The identity is
   * checked again after the write, and the row removed if it was reset in between.
   */
  private async insertFor(instanceId: string, row: EverStatsReport): Promise<void> {
    if (!(await this.identityIs(instanceId))) {
      this.logger.warn('ever_stats.send outcome=not_kept reason=identity_reset');
      return;
    }
    await this.reportsRepo.insert(row);
    await this.prune();
    if (!(await this.identityIs(instanceId))) {
      await this.reportsRepo.delete({ id: row.id });
    }
  }

  private async updateFor(instanceId: string, row: EverStatsReport): Promise<void> {
    if (!(await this.identityIs(instanceId))) {
      this.logger.warn('ever_stats.send outcome=not_kept reason=identity_reset');
      await this.reportsRepo.delete({ id: row.id });
      return;
    }
    const { id, ...fields } = row;
    await this.reportsRepo.update({ id }, fields);
    if (!(await this.identityIs(instanceId))) {
      await this.reportsRepo.delete({ id });
    }
  }

  /** Keeps the last {@link STATS_REPORTS_KEPT} rows. */
  private async prune(): Promise<void> {
    const rows = await this.reportsRepo.find({ select: { id: true, createdAt: true }, order: { createdAt: 'DESC', id: 'DESC' } });
    const old = rows.slice(STATS_REPORTS_KEPT).map(row => row.id);
    if (old.length) {
      await this.reportsRepo.delete({ id: In(old) });
    }
  }

  /** The last reports of the current identity, newest first. */
  async reports(limit = STATS_REPORTS_KEPT): Promise<EverStatsReport[]> {
    const current = await this.instance.read();
    if (!current) {
      return [];
    }
    return this.reportsRepo.find({
      where: { instanceId: current.instanceId },
      order: { createdAt: 'DESC', id: 'DESC' },
      take: Math.max(1, Math.min(STATS_REPORTS_KEPT, limit)),
    });
  }

  /** Forgets every stored report (after a reset of the identity). */
  async clearReports(): Promise<void> {
    await this.reportsRepo.createQueryBuilder().delete().from(EverStatsReport).execute();
  }
}
