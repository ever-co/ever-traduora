import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomInt } from 'crypto';
import { Repository } from 'typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverStatsLease } from '../entity/ever-stats-lease.entity';
import { EVER_STATS_SCHEDULE_ID, EverStatsSchedule } from '../entity/ever-stats-schedule.entity';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EVER_STATS_CLOCK, EverStatsClock, monthOf, previousMonth } from './ever-stats.clock';
import {
  DEFAULT_SEND_INTERVAL_S,
  FINAL_RESEND_DAYS,
  MODULE_VERSION,
  STATS_BOOT_DELAY_MS,
  STATS_BOOT_RETRY_MS,
  STATS_LEASE_MS,
  STATS_OVERDUE_DELAY_MS,
  STATS_RECOVERY_MS,
  STATS_RETRY_DELAYS_S,
  STATS_SEND_DRAIN_MS,
} from './ever-stats.constants';
import { EVER_STATS_SETTINGS, EverStatsSettings } from './ever-stats.settings';
import { EverStatsLeaseLock } from './ever-stats-lease';
import { EverStatsSenderService, StatsSendResult } from './ever-stats-sender.service';

const DAY_MS = 86_400_000;
const MAX_TIMER_MS = 2_147_483_647;

/** `false` keeps the timer from starting with the module (tests drive `boot()` and `tick()` themselves). */
export const EVER_STATS_AUTOSTART = Symbol('ever stats autostart');

/** Why *Send now* sent nothing; the controller maps each code to an answer. */
export type SendNowRefusal = 'stats_disabled' | 'no_destination' | 'busy' | 'refused_until_upgrade' | 'rate_limited';

export class SendNowRefused extends Error {
  constructor(readonly code: SendNowRefusal) {
    super(code);
    this.name = 'SendNowRefused';
  }
}

const time = (value: Date | null | undefined): number | null => (value ? new Date(value).getTime() : null);

/**
 * When reports are sent: once a day at a second drawn at random for each day (UTC); the first report a day after the
 * identity was created (10 minutes after a start when a report is more than a day overdue); on days 1-3 of a month the
 * previous month once more with `final: true`. A `setTimeout` chain whose timers never keep the process alive; no
 * scheduler dependency.
 *
 * The operator's switch is read again right before every report, so nothing is sent while it is off. Several API
 * processes share the schedule (`ever_stats_schedule`) and a lease (`ever_stats_lease`), so one of them sends, and the
 * schedule is read again under the lease. In one process, the slots, *Send now*, a switch-off and a reset of the
 * identity run one at a time (the send lock). No failure in here ever reaches the rest of the API: every timer catches
 * its errors and tries again later.
 */
@Injectable()
export class EverStatsSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EverStats');
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking: Promise<void> | null = null;
  private booted = false;
  private bootFailures = 0;
  /** The send lock of this process (see {@link serialize}); never rejects. */
  private sendLock: Promise<unknown> = Promise.resolve();
  readonly lease: EverStatsLeaseLock;
  /** How long a switch-off or a reset waits for a report another process is sending (tests shorten it). */
  drainWaitMs = STATS_SEND_DRAIN_MS;
  /** When this process will look next (for the status route). */
  nextAt: number | null = null;

  constructor(
    @InjectRepository(EverStatsSchedule) private readonly scheduleRepo: Repository<EverStatsSchedule>,
    @InjectRepository(EverStatsLease) leaseRepo: Repository<EverStatsLease>,
    @Inject(EVER_STATS_SETTINGS) private readonly settings: EverStatsSettings,
    @Inject(EVER_STATS_CLOCK) private readonly clock: EverStatsClock,
    private readonly instance: EverInstanceService,
    private readonly sender: EverStatsSenderService,
    @Optional() @Inject(EVER_STATS_AUTOSTART) private readonly autostart?: boolean,
  ) {
    this.lease = new EverStatsLeaseLock(leaseRepo, STATS_LEASE_MS);
  }

  onModuleInit(): void {
    if (this.autostart === false) {
      return;
    }
    if (!this.settings.apiUrl) {
      this.logger.warn('ever_stats.scheduler state=no_destination: no report will be sent.');
      return;
    }
    // The first look waits for the migrations, which run after the modules start
    this.arm(this.clock() + STATS_BOOT_DELAY_MS, () => this.boot());
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async readSchedule(): Promise<EverStatsSchedule> {
    const row = await this.scheduleRepo.findOne({ where: { id: EVER_STATS_SCHEDULE_ID } });
    if (row) {
      return row;
    }
    await this.scheduleRepo
      .createQueryBuilder()
      .insert()
      .into(EverStatsSchedule)
      .values({ id: EVER_STATS_SCHEDULE_ID, retryAttempt: 0 })
      .orIgnore()
      .execute();
    return this.scheduleRepo.findOneOrFail({ where: { id: EVER_STATS_SCHEDULE_ID } });
  }

  private async patchSchedule(patch: Partial<EverStatsSchedule>): Promise<void> {
    await this.scheduleRepo.update({ id: EVER_STATS_SCHEDULE_ID }, patch);
  }

  /**
   * Runs `work` once everything queued before it in this process has finished: the slots, *Send now*, a switch-off and
   * a reset of the identity never overlap here. Between processes, the lease does the same.
   */
  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.sendLock.then(work);
    this.sendLock = result.catch((): undefined => undefined);
    return result;
  }

  /** Whether another process already sent the slot due at `now` (it moved `next_send_at` on). */
  private sentAlready(schedule: EverStatsSchedule, now: number): boolean {
    const next = time(schedule.nextSendAt);
    return next !== null && next > now + 1000;
  }

  /** Runs `work` at `at` (a timer that never keeps the process alive, and whose failures never escape it). */
  private arm(at: number, work: () => Promise<void> = () => this.tick()): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);
    this.nextAt = at;
    const delay = Math.max(0, Math.min(MAX_TIMER_MS, at - this.clock()));
    this.timer = setTimeout(() => {
      this.timer = null;
      work().catch(error => {
        this.logger.warn(`ever_stats.scheduler error=${(error as Error)?.name ?? 'error'}`);
        // A failure (the database unreachable, for example) never stops the chain: try again later, from the start
        // when the first start did not complete
        if (!this.timer && !this.stopped) {
          if (this.booted) {
            this.arm(this.clock() + STATS_RECOVERY_MS);
          } else {
            const wait = STATS_BOOT_RETRY_MS[Math.min(this.bootFailures, STATS_BOOT_RETRY_MS.length - 1)];
            this.bootFailures += 1;
            this.arm(this.clock() + wait, () => this.boot());
          }
        }
      });
    }, delay);
    this.timer.unref?.();
  }

  /** The next daily slot after `now`: a random second of the next UTC day (or `now + interval` in tests). */
  nextSlot(now: number): number {
    if (this.settings.intervalS !== DEFAULT_SEND_INTERVAL_S) {
      return now + this.settings.intervalS * 1000;
    }
    const startOfNextDay = Math.floor(now / DAY_MS) * DAY_MS + DAY_MS;
    return startOfNextDay + randomInt(0, 86_400) * 1000;
  }

  /** When the first attempt of this process is due. */
  async firstDue(now: number, record: EverInstance): Promise<number> {
    const schedule = await this.readSchedule();
    const next = time(schedule.nextSendAt);
    const lastSent = time(schedule.lastSentAt);
    if (next !== null && next > now) {
      return next;
    }
    const overdue = (next !== null && next <= now) || (lastSent !== null && now - lastSent > DAY_MS);
    if (overdue) {
      return now + Math.min(STATS_OVERDUE_DELAY_MS, this.settings.intervalS * 1000);
    }
    const delay = this.settings.intervalS === DEFAULT_SEND_INTERVAL_S ? DAY_MS : this.settings.intervalS * 1000;
    return Math.max(now, (time(record.createdAt) ?? now) + delay);
  }

  /** Start: the identity, then the first timer. */
  async boot(): Promise<void> {
    const now = this.clock();
    const record = await this.instance.ensure();
    const due = await this.firstDue(now, record);
    this.booted = true;
    this.arm(due);
  }

  /** One slot. Exposed for tests; the timer calls it. */
  tick(): Promise<void> {
    if (!this.ticking) {
      this.ticking = this.serialize(() => this.runSlotLocked()).finally(() => {
        this.ticking = null;
      });
    }
    return this.ticking;
  }

  private async runSlotLocked(): Promise<void> {
    const now = this.clock();
    const early = await this.readSchedule();
    if (this.sentAlready(early, now)) {
      this.arm(time(early.nextSendAt));
      return;
    }
    if (!(await this.lease.acquire(now))) {
      this.arm(now + STATS_LEASE_MS);
      return;
    }
    try {
      // Read again under the lease: another process may have sent this slot (and moved the schedule on) between the
      // first read and the lease
      const schedule = await this.readSchedule();
      if (this.sentAlready(schedule, now)) {
        this.arm(time(schedule.nextSendAt));
        return;
      }
      if (!(await this.instance.isStatsEnabledUi())) {
        this.logger.log('ever_stats.send outcome=skipped_ui_off');
        this.arm(this.nextSlot(now));
        return;
      }
      if (schedule.blockedModuleVersion === MODULE_VERSION) {
        this.logger.log('ever_stats.send outcome=skipped_refused_until_upgrade');
        this.arm(this.nextSlot(now));
        return;
      }
      await this.resetIfKeyUnreadable();
      const next = await this.sendDue(now, await this.readSchedule());
      await this.patchSchedule({ nextSendAt: new Date(next) });
      this.arm(next);
    } finally {
      await this.lease.release();
    }
  }

  /**
   * When TR_SECRET changed since the statistics key was stored, the key can no longer be read: the identity is reset
   * (new id and key), so Ever Platform never sees a second key for an id it already knows. Runs under the lease.
   */
  private async resetIfKeyUnreadable(): Promise<void> {
    const record = await this.instance.ensure();
    if (this.instance.keyState(record) !== 'key_unreadable') {
      return;
    }
    this.logger.warn('ever_instance.key_unreadable: the statistics key was stored with another TR_SECRET; the identity is reset.');
    await this.instance.resetIdentity(null);
    await this.forgetHistory();
  }

  /** A new identity starts a new series: its report history and any refusal are forgotten. */
  private async forgetHistory(): Promise<void> {
    await this.sender.clearReports();
    await this.patchSchedule({ blockedModuleVersion: null, retryAttempt: 0, lastFinalSentFor: null });
  }

  /** One report, unless the operator's switch is off now: it is read right before every report. */
  private async sendIfEnabled(input: { period: string; final: boolean }): Promise<StatsSendResult | null> {
    if (!(await this.instance.isStatsEnabledUi())) {
      this.logger.log(`ever_stats.send outcome=skipped_ui_off final=${input.final}`);
      return null;
    }
    return this.sender.send(input);
  }

  /** Sends what is due at `now` (the closed previous month on days 1-3, then the running month); returns the next time. */
  async sendDue(now: number, schedule: EverStatsSchedule): Promise<number> {
    const period = monthOf(now);
    const day = new Date(now).getUTCDate();
    const results: StatsSendResult[] = [];
    const patch: Partial<EverStatsSchedule> = { lastAttemptAt: new Date(now) };
    const previous = previousMonth(period);
    if (FINAL_RESEND_DAYS.includes(day) && schedule.lastFinalSentFor !== previous) {
      const finalResult = await this.sendIfEnabled({ period: previous, final: true });
      if (!finalResult) {
        return this.nextSlot(now);
      }
      results.push(finalResult);
      if (finalResult.row.status === 'sent' || finalResult.row.status === 'rejected') {
        patch.lastFinalSentFor = previous;
      }
    }
    // The switch may have been turned off while the closed month was being sent
    const result = await this.sendIfEnabled({ period, final: false });
    if (result) {
      results.push(result);
    }
    if (!results.length) {
      return this.nextSlot(now);
    }
    return this.record(now, schedule, results, patch);
  }

  private async record(now: number, schedule: EverStatsSchedule, results: StatsSendResult[], patch: Partial<EverStatsSchedule>): Promise<number> {
    patch.lastStatus = results[results.length - 1].row.status;
    if (results.some(r => r.row.status === 'sent')) patch.lastSentAt = new Date(this.clock());
    if (results.some(r => r.retry === 'module_upgrade')) patch.blockedModuleVersion = MODULE_VERSION;
    let next = this.nextSlot(now);
    const attempt = schedule.retryAttempt ?? 0;
    if (results.some(r => r.retry === 'backoff') && attempt < STATS_RETRY_DELAYS_S.length) {
      next = now + STATS_RETRY_DELAYS_S[attempt] * 1000;
      patch.retryAttempt = attempt + 1;
    } else {
      patch.retryAttempt = 0;
    }
    await this.patchSchedule(patch);
    return next;
  }

  /**
   * *Send now*: the running month, at once, when the operator's switch is on, at most once per 10 minutes, and, like
   * the slots, not after Ever Platform refused this module version (422) until it is upgraded. It waits for this
   * process's send lock and takes the lease, and checks the limits under both, so two calls never both send. Throws a
   * {@link SendNowRefused} the controller maps to an answer.
   */
  async sendNow(minIntervalMs: number): Promise<StatsSendResult> {
    if (!this.settings.apiUrl) throw new SendNowRefused('no_destination');
    return this.serialize(() => this.sendNowLocked(minIntervalMs));
  }

  private async sendNowLocked(minIntervalMs: number): Promise<StatsSendResult> {
    const now = this.clock();
    if (!(await this.instance.isStatsEnabledUi())) throw new SendNowRefused('stats_disabled');
    if (!(await this.lease.acquire(now))) throw new SendNowRefused('busy');
    try {
      const schedule = await this.readSchedule();
      if (schedule.blockedModuleVersion === MODULE_VERSION) {
        throw new SendNowRefused('refused_until_upgrade');
      }
      const lastManual = time(schedule.lastManualSendAt);
      if (lastManual !== null && now - lastManual < minIntervalMs) {
        throw new SendNowRefused('rate_limited');
      }
      await this.patchSchedule({ lastManualSendAt: new Date(now) });
      await this.resetIfKeyUnreadable();
      const result = await this.sendIfEnabled({ period: monthOf(now), final: false });
      if (!result) throw new SendNowRefused('stats_disabled');
      const patch: Partial<EverStatsSchedule> = { lastAttemptAt: new Date(now), lastStatus: result.row.status };
      if (result.row.status === 'sent') patch.lastSentAt = new Date(this.clock());
      if (result.retry === 'module_upgrade') patch.blockedModuleVersion = MODULE_VERSION;
      await this.patchSchedule(patch);
      return result;
    } finally {
      await this.lease.release();
    }
  }

  /**
   * Waits until no other process sends (it holds the lease), at most {@link drainWaitMs}, and takes the lease: whether
   * this process now holds it.
   */
  private async waitForOtherSenders(): Promise<boolean> {
    const held = await this.lease.acquireWithin(this.clock, this.drainWaitMs);
    if (!held) {
      this.logger.warn('ever_stats.scheduler state=lease_still_held');
    }
    return held;
  }

  /**
   * The operator switches the statistics on or off. The switch is stored first, and every report reads it right
   * before it is sent; switching off then waits for a report already being sent, here (the send lock) and in another
   * process (the lease, at most {@link drainWaitMs}), so that when the answer comes no report is left in flight.
   */
  async setEnabled(userId: string, enabled: boolean): Promise<EverInstance> {
    const record = await this.instance.setStatsEnabledUi(userId, enabled);
    if (!enabled) {
      await this.serialize(async () => {
        if (await this.waitForOtherSenders()) {
          await this.lease.release();
        }
      });
    }
    return record;
  }

  /**
   * *Reset instance identity*: a new id and key. It waits for a report already being sent (here, and at most
   * {@link drainWaitMs} in another process), then resets and forgets the report history and any refusal, so a report
   * of the old identity cannot write itself back into the cleared history.
   */
  async resetIdentity(userId: string): Promise<EverInstance> {
    return this.serialize(async () => {
      const held = await this.waitForOtherSenders();
      try {
        const record = await this.instance.resetIdentity(userId);
        await this.forgetHistory();
        return record;
      } finally {
        if (held) await this.lease.release();
      }
    });
  }
}
