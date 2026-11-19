import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { EverStatsSchedule } from '../entity/ever-stats-schedule.entity';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EVER_STATS_CLOCK, EverStatsClock, monthOf, previousMonth } from './ever-stats.clock';
import { EVER_STATS_CONFIG, EverStatsConfig } from './ever-stats.config';
import {
  DEFAULT_SEND_INTERVAL_S,
  FINAL_RESEND_DAYS,
  MODULE_VERSION,
  STATS_LEASE_MS,
  STATS_OVERDUE_DELAY_MS,
  STATS_RETRY_DELAYS_S,
} from './ever-stats.constants';
import { EverStatsSchedulePatch, EverStatsScheduleStore } from './ever-stats-schedule.store';
import { EverStatsSenderService } from './ever-stats-sender.service';

const DAY_MS = 86400000;

/** `false` keeps the timer from starting at boot (tests drive `tick()` themselves). */
export const EVER_STATS_AUTOSTART = Symbol('ever stats autostart');

const MAX_TIMER_MS = 2147483647;

/** How long a reset waits for the lease: two sends of at most 10 seconds each, and their records. */
export const STATS_RESET_WAIT_MS = 30000;

/** After a failed slot or start, the next try. */
const SCHEDULER_RECOVERY_MS = 10 * 60 * 1000;

/** Why *Send now* sent nothing; the controller maps each to an answer. */
export type SendNowRefusal = 'stats_disabled' | 'no_destination' | 'busy' | 'refused_until_upgrade' | 'rate_limited';

export class SendNowRefused extends Error {
  constructor(readonly reason: SendNowRefusal) {
    super(reason);
    this.name = 'SendNowRefused';
  }
}

/**
 * When reports are sent: once a day at a second drawn at random for each day (UTC); the first report a day after the
 * first start (10 minutes after a start when a report is more than a day overdue); on days 1-3 of a month the previous
 * month once more with `final: true`. A `setTimeout` chain that never keeps the process alive, no extra dependency. The
 * operator's switch is read again right before every report, so nothing is sent while it is off. Several API processes
 * share the schedule and a lease, so one of them sends; in one process the slots, *Send now* and a reset of the identity
 * run one at a time.
 */
@Injectable()
export class EverStatsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EverStatsSchedulerService.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private booted = false;
  /** The send lock of this process (see {@link serialize}); never rejects. */
  private sendLock: Promise<unknown> = Promise.resolve();
  readonly schedule: EverStatsScheduleStore;
  /** When this process will look next (for the status route). */
  nextAt: number | null = null;
  /** How long a reset waits for a report another process is sending (tests shorten it). */
  resetWaitMs = STATS_RESET_WAIT_MS;

  constructor(
    @InjectRepository(EverStatsSchedule) scheduleRepo: Repository<EverStatsSchedule>,
    @Inject(EVER_STATS_CONFIG) private readonly config: EverStatsConfig,
    @Inject(EVER_STATS_CLOCK) private readonly clock: EverStatsClock,
    private readonly instance: EverInstanceService,
    private readonly sender: EverStatsSenderService,
    @Optional() @Inject(EVER_STATS_AUTOSTART) private readonly autostart?: boolean,
  ) {
    this.schedule = new EverStatsScheduleStore(scheduleRepo, STATS_LEASE_MS);
  }

  onModuleInit(): void {
    if (this.autostart === false) {
      return;
    }
    if (!this.config.apiUrl) {
      this.logger.warn('ever_stats.scheduler state=no_destination: no report will be sent.');
      return;
    }
    // The first look happens a moment after the start, never during it
    this.arm(this.clock() + 5000, () => this.boot());
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Runs `work` once everything queued before it in this process has finished. Between processes, the lease does the same. */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.sendLock.then(work);
    this.sendLock = result.catch(() => undefined);
    return result;
  }

  /** Whether another process already sent the slot due at `now` (it moved `nextSendAt` on). */
  private sentAlready(row: EverStatsSchedule, now: number): boolean {
    return !!row.nextSendAt && row.nextSendAt > now + 1000;
  }

  /** Runs `work` at `at` (a timer that never keeps the process alive). */
  private arm(at: number, work: () => Promise<void> = () => this.tick()): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.nextAt = at;
    const delay = Math.max(0, Math.min(MAX_TIMER_MS, at - this.clock()));
    this.timer = setTimeout(() => {
      this.timer = null;
      work().catch(error => {
        this.logger.warn(`ever_stats.scheduler error=${(error && error.name) || 'error'}`);
        // A failure (the database unreachable, for example) never stops the chain: try again later, from the start
        // when the first start did not complete
        if (!this.timer && !this.stopped) {
          this.arm(this.clock() + SCHEDULER_RECOVERY_MS, this.booted ? () => this.tick() : () => this.boot());
        }
      });
    }, delay);
    this.timer.unref?.();
  }

  /** The next daily slot after `now`: a random second of the next UTC day (or `now + interval` in tests). */
  nextSlot(now: number): number {
    if (this.config.intervalS !== DEFAULT_SEND_INTERVAL_S) {
      return now + this.config.intervalS * 1000;
    }
    const startOfNextDay = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
    return startOfNextDay + randomInt(0, 86400) * 1000;
  }

  /** When the first attempt of this process is due. */
  async firstDue(now: number): Promise<number> {
    const row = await this.schedule.read();
    if (row.nextSendAt && row.nextSendAt > now) {
      return row.nextSendAt;
    }
    const overdue = (row.nextSendAt && row.nextSendAt <= now) || (row.lastSentAt && now - row.lastSentAt > DAY_MS);
    if (overdue) {
      return now + Math.min(STATS_OVERDUE_DELAY_MS, this.config.intervalS * 1000);
    }
    let firstBootAt = row.firstBootAt;
    if (!firstBootAt) {
      firstBootAt = now;
      await this.schedule.patch({ firstBootAt });
    }
    const delay = this.config.intervalS === DEFAULT_SEND_INTERVAL_S ? DAY_MS : this.config.intervalS * 1000;
    return Math.max(now, firstBootAt + delay);
  }

  /** Boot: the identity, then the first timer. */
  async boot(): Promise<void> {
    const now = this.clock();
    await this.instance.ensure();
    const due = await this.firstDue(now);
    this.booted = true;
    this.arm(due);
  }

  /** One slot. Exposed for tests; the timer calls it. */
  tick(): Promise<void> {
    return this.serialize(() => this.runSlot());
  }

  private async runSlot(): Promise<void> {
    const now = this.clock();
    const early = await this.schedule.read();
    if (this.sentAlready(early, now)) {
      this.arm(early.nextSendAt);
      return;
    }
    if (!(await this.schedule.acquire(now))) {
      this.arm(now + STATS_LEASE_MS);
      return;
    }
    try {
      // Read again under the lease: another process may have sent this slot meanwhile
      const row = await this.schedule.read();
      if (this.sentAlready(row, now)) {
        this.arm(row.nextSendAt);
        return;
      }
      if (!(await this.instance.isStatsEnabledUi())) {
        this.logger.log('ever_stats.send outcome=skipped_ui_off');
        const later = this.nextSlot(now);
        await this.schedule.patch({ nextSendAt: later });
        this.arm(later);
        return;
      }
      if (row.blockedModuleVersion === MODULE_VERSION) {
        this.logger.log('ever_stats.send outcome=skipped_refused_until_upgrade');
        const later = this.nextSlot(now);
        await this.schedule.patch({ nextSendAt: later });
        this.arm(later);
        return;
      }
      const next = await this.sendDue(now, row);
      await this.schedule.patch({ nextSendAt: next });
      this.arm(next);
    } finally {
      await this.schedule.release();
    }
  }

  /** One report, unless the operator's switch is off now: it is read right before every report. */
  private async sendIfEnabled(input: { period: string; final: boolean }): Promise<EverStatsReport | null> {
    if (!(await this.instance.isStatsEnabledUi())) {
      this.logger.log(`ever_stats.send outcome=skipped_ui_off final=${input.final}`);
      return null;
    }
    return this.sender.send(input);
  }

  /** Sends what is due at `now` (the closed previous month on days 1-3, then the running month); returns the next time. */
  async sendDue(now: number, row: EverStatsSchedule): Promise<number> {
    const period = monthOf(now);
    const day = new Date(now).getUTCDate();
    const rows: EverStatsReport[] = [];
    const patch: EverStatsSchedulePatch = { lastAttemptAt: now };
    const previous = previousMonth(period);
    if (FINAL_RESEND_DAYS.includes(day) && row.lastFinalSentFor !== previous) {
      const finalRow = await this.sendIfEnabled({ period: previous, final: true });
      if (!finalRow) {
        return this.nextSlot(now);
      }
      rows.push(finalRow);
      // Only a delivered closing report is final: a refused one stays eligible (after an upgrade, or a reset)
      if (finalRow.status === 'sent') {
        patch.lastFinalSentFor = previous;
      }
      // Refused until the module is upgraded (by Ever Platform, or by the checks here): nothing more is sent
      if (finalRow.retry === 'module_upgrade') {
        return this.record(now, row, rows, patch);
      }
    }
    // The switch may have been turned off while the closed month was being sent
    const current = await this.sendIfEnabled({ period, final: false });
    if (current) {
      rows.push(current);
    }
    if (!rows.length) {
      return this.nextSlot(now);
    }
    return this.record(now, row, rows, patch);
  }

  private async record(now: number, row: EverStatsSchedule, rows: EverStatsReport[], patch: EverStatsSchedulePatch): Promise<number> {
    patch.lastStatus = rows[rows.length - 1].status;
    if (rows.some(r => r.status === 'sent')) patch.lastSentAt = this.clock();
    if (rows.some(r => r.retry === 'module_upgrade')) patch.blockedModuleVersion = MODULE_VERSION;
    let next = this.nextSlot(now);
    if (rows.some(r => r.retry === 'backoff')) {
      const attempt = row.retryAttempt || 0;
      if (attempt < STATS_RETRY_DELAYS_S.length) {
        next = now + STATS_RETRY_DELAYS_S[attempt] * 1000;
        patch.retryAttempt = attempt + 1;
      } else {
        patch.retryAttempt = 0;
      }
    } else {
      patch.retryAttempt = 0;
    }
    await this.schedule.patch(patch);
    return next;
  }

  /**
   * *Send now*: the running month, at once, when the operator's switch is on, at most once per 10 minutes, and, like the
   * slots, not after Ever Platform refused this module version (`422`) until it is upgraded. Throws
   * {@link SendNowRefused}, which the controller maps to an answer.
   */
  async sendNow(minIntervalMs: number): Promise<EverStatsReport> {
    if (!this.config.apiUrl) throw new SendNowRefused('no_destination');
    return this.serialize(() => this.sendNowLocked(minIntervalMs));
  }

  private async sendNowLocked(minIntervalMs: number): Promise<EverStatsReport> {
    const now = this.clock();
    if (!(await this.instance.isStatsEnabledUi())) throw new SendNowRefused('stats_disabled');
    if (!(await this.schedule.acquire(now))) throw new SendNowRefused('busy');
    try {
      const row = await this.schedule.read();
      if (row.blockedModuleVersion === MODULE_VERSION) {
        throw new SendNowRefused('refused_until_upgrade');
      }
      if (row.lastManualSendAt && now - row.lastManualSendAt < minIntervalMs) {
        throw new SendNowRefused('rate_limited');
      }
      await this.schedule.patch({ lastManualSendAt: now });
      const report = await this.sendIfEnabled({ period: monthOf(now), final: false });
      if (!report) throw new SendNowRefused('stats_disabled');
      const patch: EverStatsSchedulePatch = { lastAttemptAt: now, lastStatus: report.status };
      if (report.status === 'sent') patch.lastSentAt = this.clock();
      if (report.retry === 'module_upgrade') patch.blockedModuleVersion = MODULE_VERSION;
      await this.schedule.patch(patch);
      return report;
    } finally {
      await this.schedule.release();
    }
  }

  /**
   * *Reset instance identity*: a new instance id and statistics key, and a new series (the history and any refusal are
   * forgotten). It runs under this process's send lock and the shared lease, so no report of the old identity, here or
   * in another process, is being sent meanwhile and can write itself back. Throws {@link SendNowRefused} `busy` when
   * another process keeps the lease longer than {@link STATS_RESET_WAIT_MS}.
   */
  async resetIdentity(userId: string): Promise<EverInstance> {
    return this.serialize(async () => {
      if (!(await this.schedule.acquireWithin(this.clock, this.resetWaitMs))) {
        throw new SendNowRefused('busy');
      }
      try {
        const record = await this.instance.resetIdentity(userId);
        await this.sender.clearReports();
        await this.schedule.patch({ blockedModuleVersion: null, retryAttempt: 0, lastFinalSentFor: null });
        return record;
      } finally {
        await this.schedule.release();
      }
    });
  }
}
