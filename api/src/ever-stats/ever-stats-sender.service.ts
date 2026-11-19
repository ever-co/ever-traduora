import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as http from 'http';
import * as https from 'https';
import { In, Repository } from 'typeorm';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { EverInstanceService, EverInstanceSigningIdentity } from '../ever-instance/ever-instance.service';
import { EverInstanceKeyError, signBytes } from '../ever-instance/key-wrap';
import { EVER_STATS_CLOCK, EverStatsClock } from './ever-stats.clock';
import { EVER_STATS_CONFIG, EverStatsConfig } from './ever-stats.config';
import {
  CONTRACTS_VERSION,
  PRODUCT,
  STATS_HEADERS,
  STATS_REPORTS_KEPT,
  STATS_REPORTS_PATH,
  STATS_SEND_TIMEOUT_MS,
  STATS_SIGNATURE_PREFIX,
} from './ever-stats.constants';
import { EverStatsCollectorService } from './ever-stats-collector.service';

/** The request a send makes. */
export interface StatsRequest {
  method: string;
  headers: Record<string, string>;
  body: Buffer;
}

/** The HTTP client of the module, replaced in tests: one request, its status, nothing else. */
export type StatsFetch = (url: string, init: StatsRequest) => Promise<{ status: number }>;

export const EVER_STATS_FETCH = Symbol('ever stats fetch');

/**
 * Posts with Node's own `http`/`https` client: no redirect is ever followed (the client does not follow them), no cookie
 * jar, no proxy, no connection reuse, and the exchange is cut after 10 seconds. The answer's body is never read: the
 * connection is closed as soon as the status arrives.
 */
export const defaultStatsFetch: StatsFetch = (url, init) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;
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
        resolve({ status: response.statusCode || 0 });
        // Only the status is read: the connection ends here, so a slow body cannot hold it open
        response.destroy();
      },
    );
    const deadline: NodeJS.Timeout = setTimeout(() => request.destroy(new Error('timeout')), STATS_SEND_TIMEOUT_MS);
    deadline.unref?.();
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', error => {
      clearTimeout(deadline);
      reject(error);
    });
    request.end(init.body);
  });

export type StatsReportStatus = 'pending' | 'sent' | 'rejected' | 'failed' | 'skipped';

/** What happens after an attempt. */
export type StatsRetry = 'none' | 'backoff' | 'next_day' | 'module_upgrade';

/** How Ever Platform's answer is recorded. */
export function classifyAnswer(httpStatus: number | null): { status: StatsReportStatus; retry: StatsRetry; hint: string | null } {
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

/** A new report row (not stored yet). */
function reportRow(values: Partial<EverStatsReport> & Pick<EverStatsReport, 'reportId' | 'period' | 'final' | 'createdAt'>): EverStatsReport {
  const row = new EverStatsReport();
  row.reportId = values.reportId;
  row.period = values.period;
  row.final = values.final;
  row.payload = values.payload ?? '';
  row.signature = values.signature ?? '';
  row.createdAt = values.createdAt;
  row.sentAt = values.sentAt ?? null;
  row.httpStatus = values.httpStatus ?? null;
  row.status = values.status ?? 'pending';
  row.attempts = values.attempts ?? 0;
  row.retry = values.retry ?? 'none';
  row.error = values.error ?? null;
  row.hint = values.hint ?? null;
  return row;
}

/**
 * Signs and sends one report. The report is serialised once; those exact bytes are signed with the installation's
 * statistics key, stored, and posted unchanged: `POST {apiUrl}/v1/stats/reports`, with the public key and the signature
 * in the headers, no cookie, no credential, no redirect followed, within 10 seconds (see {@link defaultStatsFetch}).
 * This is the only request the module makes.
 */
@Injectable()
export class EverStatsSenderService {
  private readonly logger = new Logger(EverStatsSenderService.name);

  constructor(
    @InjectRepository(EverStatsReport) private readonly reportsRepo: Repository<EverStatsReport>,
    @Inject(EVER_STATS_CONFIG) private readonly config: EverStatsConfig,
    @Inject(EVER_STATS_CLOCK) private readonly clock: EverStatsClock,
    @Inject(EVER_STATS_FETCH) private readonly fetchFn: StatsFetch,
    private readonly instance: EverInstanceService,
    private readonly collector: EverStatsCollectorService,
  ) {}

  /** The `User-Agent` of a report: `ever-connect-sdk/<contract version> (traduora/<version>)`. */
  userAgent(): string {
    return `ever-connect-sdk/${CONTRACTS_VERSION} (${PRODUCT}/${this.config.release.version})`;
  }

  /** Builds, checks, signs, stores and sends the report of `period`. */
  async send(input: { period: string; final: boolean }): Promise<EverStatsReport> {
    const now = this.clock();
    let identity: EverInstanceSigningIdentity;
    try {
      identity = await this.instance.signingIdentity();
    } catch (error) {
      const code = error instanceof EverInstanceKeyError ? error.code : 'identity_unavailable';
      this.logger.warn(`ever_stats.send outcome=failed reason=${code}`);
      return this.store(
        reportRow({
          reportId: `local-${now}`,
          period: input.period,
          final: input.final,
          createdAt: now,
          status: 'failed',
          retry: 'next_day',
          error: code === 'unreadable' || code === 'malformed' ? 'key_unreadable' : code,
          hint: code === 'unreadable' || code === 'malformed' ? 'reset_identity' : null,
        }),
      );
    }

    const instanceId = identity.record.instanceId;
    const built = await this.collector.build({ instanceId, period: input.period, final: input.final, now });
    const reportId = String(built.report.report_id);
    if (built.error) {
      this.logger.warn(`ever_stats.send outcome=rejected reason=${built.error} final=${input.final}`);
      return this.storeFor(
        instanceId,
        reportRow({
          reportId,
          period: input.period,
          final: input.final,
          // A report over the size limit is not kept either
          payload: built.check.status === 413 ? '' : built.text,
          createdAt: now,
          status: 'rejected',
          retry: 'module_upgrade',
          error: built.error,
        }),
      );
    }

    const signature = `${STATS_SIGNATURE_PREFIX}${signBytes(identity.privateKeyDer, built.bytes).toString('base64url')}`;
    const row = reportRow({
      reportId,
      period: input.period,
      final: input.final,
      payload: built.text,
      signature,
      createdAt: now,
      status: 'pending',
      attempts: 1,
    });
    // Stored before the request leaves, so the operator can always read what was sent
    await this.storeFor(instanceId, row);

    if (!this.config.apiUrl) {
      row.status = 'failed';
      row.retry = 'next_day';
      row.error = 'api_url_unusable';
      return this.storeFor(instanceId, row);
    }

    // The operator may have switched the statistics off while the report was being built and stored
    if (!(await this.instance.isStatsEnabledUi())) {
      this.logger.log(`ever_stats.send outcome=skipped_ui_off final=${input.final}`);
      row.status = 'skipped';
      row.attempts = 0;
      row.error = 'switched_off';
      return this.storeFor(instanceId, row);
    }

    let httpStatus: number | null = null;
    try {
      const response = await this.fetchFn(`${this.config.apiUrl}${STATS_REPORTS_PATH}`, {
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
    row.sentAt = outcome.status === 'sent' ? this.clock() : null;
    row.httpStatus = httpStatus;
    row.status = outcome.status;
    row.retry = outcome.retry;
    row.error = httpStatus === null ? 'connection_error' : outcome.status === 'sent' ? null : `http_${httpStatus}`;
    row.hint = outcome.hint;
    return this.storeFor(instanceId, row);
  }

  /**
   * Writes the row of a report built for `instanceId`, unless the identity was reset meanwhile: a reset clears the
   * history, and a report of the old identity that finishes later must not write itself back into it.
   */
  private async storeFor(instanceId: string, row: EverStatsReport): Promise<EverStatsReport> {
    const current = await this.instance.read();
    if (!current || current.instanceId !== instanceId) {
      this.logger.warn('ever_stats.send outcome=not_kept reason=identity_reset');
      return row;
    }
    return this.store(row);
  }

  /** Writes a row and keeps the last {@link STATS_REPORTS_KEPT}. */
  async store(row: EverStatsReport): Promise<EverStatsReport> {
    await this.reportsRepo.save(row);
    const rows = await this.reportsRepo.find({ select: { reportId: true, createdAt: true }, order: { createdAt: 'DESC', reportId: 'DESC' } });
    const old = rows.slice(STATS_REPORTS_KEPT).map(r => r.reportId);
    if (old.length) {
      await this.reportsRepo.delete({ reportId: In(old) });
    }
    return row;
  }

  /** The last reports, newest first. */
  async reports(limit = STATS_REPORTS_KEPT): Promise<EverStatsReport[]> {
    return this.reportsRepo.find({
      order: { createdAt: 'DESC', reportId: 'DESC' },
      take: Math.max(1, Math.min(STATS_REPORTS_KEPT, limit)),
    });
  }

  /** Forgets every stored report (after a reset of the identity). */
  async clearReports(): Promise<void> {
    await this.reportsRepo.clear();
  }
}
