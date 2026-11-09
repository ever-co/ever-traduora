import { describeOnSqlite } from '../../test/memory-database';
import { StatsHarness, statsHarness, TEST_SETTINGS } from '../../test/ever-stats-unit';
import { config } from '../config';
import { EverStatsLease } from '../entity/ever-stats-lease.entity';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { EverStatsSchedule } from '../entity/ever-stats-schedule.entity';
import { MODULE_VERSION, STATS_SEND_NOW_INTERVAL_MS } from './ever-stats.constants';
import { EverStatsSchedulerService, SendNowRefused } from './ever-stats-scheduler.service';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const flush = async (times = 20) => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

describe('EverStatsSchedulerService timers', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('never lets a failure escape: a failed start is tried again later, never rejected unhandled', async () => {
    jest.useFakeTimers();
    const unhandled = jest.fn();
    process.on('unhandledRejection', unhandled);
    const instance = { ensure: jest.fn().mockRejectedValue(new Error('the database is not ready')) };
    let now = Date.parse('2026-11-15T12:00:00Z');
    const scheduler = new EverStatsSchedulerService({} as any, {} as any, TEST_SETTINGS(), () => now, instance as any, {} as any, true);
    try {
      scheduler.onModuleInit();
      expect(scheduler.nextAt).toBe(now + 15_000);
      now += 15_000;
      jest.advanceTimersByTime(15_000);
      await flush();
      expect(instance.ensure).toHaveBeenCalledTimes(1);
      // Tried again after 30 s, then 2 min, then every 10 min
      expect(scheduler.nextAt).toBe(now + 30_000);
      now += 30_000;
      jest.advanceTimersByTime(30_000);
      await flush();
      expect(instance.ensure).toHaveBeenCalledTimes(2);
      expect(scheduler.nextAt).toBe(now + 120_000);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      scheduler.onModuleDestroy();
      process.off('unhandledRejection', unhandled);
    }
  });

  it('does not start without a usable destination, nor when told not to', () => {
    jest.useFakeTimers();
    const noDestination = new EverStatsSchedulerService(
      {} as any,
      {} as any,
      { ...TEST_SETTINGS(), apiUrl: null },
      Date.now,
      {} as any,
      {} as any,
      true,
    );
    noDestination.onModuleInit();
    expect(noDestination.nextAt).toBeNull();
    const notStarted = new EverStatsSchedulerService({} as any, {} as any, TEST_SETTINGS(), Date.now, {} as any, {} as any, false);
    notStarted.onModuleInit();
    expect(notStarted.nextAt).toBeNull();
  });
});

describeOnSqlite('EverStatsSchedulerService', () => {
  let h: StatsHarness;

  beforeEach(async () => {
    h = await statsHarness();
  });

  afterEach(async () => {
    await h.close();
  });

  const schedule = () => h.dataSource.getRepository(EverStatsSchedule).findOneOrFail({ where: { id: 'stats' } });
  const patchSchedule = (patch: Partial<EverStatsSchedule>) => h.dataSource.getRepository(EverStatsSchedule).update({ id: 'stats' }, patch);
  const reports = () => h.dataSource.getRepository(EverStatsReport).find({ order: { createdAt: 'ASC' } });
  const sentPeriods = () => h.requests.map(r => JSON.parse(r.body.toString()) as { period: string; final: boolean; instance_id: string });

  describe('when the first report is due', () => {
    it('a day after the identity was created', async () => {
      h.clock.now = Date.now();
      const record = await h.instance.ensure();
      expect(await h.scheduler.firstDue(h.clock.now, record)).toBe(record.createdAt.getTime() + DAY);
    });

    it('10 minutes after a start when the last report is more than a day old', async () => {
      const record = await h.instance.ensure();
      await patchSchedule({ lastSentAt: new Date(h.clock.now - 2 * DAY) });
      expect(await h.scheduler.firstDue(h.clock.now, record)).toBe(h.clock.now + 10 * 60_000);
    });

    it('at the stored slot when it is still ahead', async () => {
      const record = await h.instance.ensure();
      await patchSchedule({ nextSendAt: new Date(h.clock.now + 5 * HOUR) });
      expect(await h.scheduler.firstDue(h.clock.now, record)).toBe(h.clock.now + 5 * HOUR);
    });

    it('then once a day, at a random second of the next UTC day', () => {
      for (let i = 0; i < 20; i++) {
        const next = h.scheduler.nextSlot(h.clock.now);
        expect(next).toBeGreaterThanOrEqual(Date.parse('2026-11-16T00:00:00Z'));
        expect(next).toBeLessThan(Date.parse('2026-11-17T00:00:00Z'));
      }
    });
  });

  it('a slot sends the running month and stores the next slot', async () => {
    await h.scheduler.tick();
    expect(sentPeriods()).toEqual([expect.objectContaining({ period: '2026-11', final: false })]);
    const s = await schedule();
    expect(s.lastStatus).toBe('sent');
    expect(s.lastSentAt).toBeInstanceOf(Date);
    expect(s.nextSendAt.getTime()).toBeGreaterThanOrEqual(Date.parse('2026-11-16T00:00:00Z'));
    // A second process that wakes up for the same slot sends nothing: the schedule moved on
    await h.newProcess().scheduler.tick();
    expect(h.requests).toHaveLength(1);
  });

  it('sends the closed previous month once more with final: true on days 1-3', async () => {
    h.clock.now = Date.parse('2026-12-02T08:00:00Z');
    await h.scheduler.tick();
    expect(sentPeriods().map(r => [r.period, r.final])).toEqual([
      ['2026-11', true],
      ['2026-12', false],
    ]);
    expect((await schedule()).lastFinalSentFor).toBe('2026-11');
    h.clock.now = Date.parse('2026-12-03T08:00:00Z');
    await patchSchedule({ nextSendAt: null });
    await h.scheduler.tick();
    expect(sentPeriods().map(r => [r.period, r.final])).toEqual([
      ['2026-11', true],
      ['2026-12', false],
      ['2026-12', false],
    ]);
  });

  it('makes no request while the operator switch is off', async () => {
    await h.instance.setStatsEnabledUi('operator', false);
    await h.scheduler.tick();
    expect(h.requests).toHaveLength(0);
    expect(await reports()).toEqual([]);
  });

  it('reads the switch again before the second report of days 1-3', async () => {
    h.clock.now = Date.parse('2026-12-01T08:00:00Z');
    h.answer.status = () => {
      // Switched off while the closed month is being sent
      void h.instance.setStatsEnabledUi('operator', false);
      return 202;
    };
    await h.scheduler.tick();
    expect(sentPeriods().map(r => [r.period, r.final])).toEqual([['2026-11', true]]);
  });

  it('makes no request without the lease (another process is sending)', async () => {
    await h.dataSource
      .getRepository(EverStatsLease)
      .update({ owner: 'stats' }, { leasedBy: 'another-process', leaseUntil: new Date(h.clock.now + 60_000) });
    await h.scheduler.tick();
    expect(h.requests).toHaveLength(0);
    // Once that lease expires, the slot is sent
    h.clock.now += 120_000;
    await h.scheduler.tick();
    expect(h.requests).toHaveLength(1);
  });

  it('reads the schedule again under the lease', async () => {
    const lease = h.scheduler.lease;
    const acquire = lease.acquire.bind(lease);
    jest.spyOn(lease, 'acquire').mockImplementation(async (now: number) => {
      // Another process sent this slot between the first read and the lease
      await patchSchedule({ nextSendAt: new Date(now + DAY) });
      return acquire(now);
    });
    await h.scheduler.tick();
    expect(h.requests).toHaveLength(0);
  });

  it('retries a failure after 1 h, 4 h and 12 h, then at the next daily slot', async () => {
    h.answer.status = 503;
    const start = h.clock.now;
    await h.scheduler.tick();
    expect((await schedule()).nextSendAt.getTime()).toBe(start + HOUR);
    for (const [wait, expected] of [
      [HOUR, 4 * HOUR],
      [4 * HOUR, 12 * HOUR],
    ]) {
      h.clock.now += wait;
      await h.scheduler.tick();
      expect((await schedule()).nextSendAt.getTime()).toBe(h.clock.now + expected);
    }
    h.clock.now += 12 * HOUR;
    await h.scheduler.tick();
    const next = (await schedule()).nextSendAt.getTime();
    expect(next).toBeGreaterThan(h.clock.now + 10 * HOUR);
    expect((await schedule()).retryAttempt).toBe(0);
    expect(h.requests).toHaveLength(4);
  });

  it('stops after a 422 until the module version changes, Send now included', async () => {
    h.answer.status = 422;
    await h.scheduler.tick();
    expect((await schedule()).blockedModuleVersion).toBe(MODULE_VERSION);
    h.clock.now += 2 * DAY;
    await h.scheduler.tick();
    await expect(h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS)).rejects.toMatchObject({ code: 'refused_until_upgrade' });
    expect(h.requests).toHaveLength(1);
    // Another module version sends again
    await patchSchedule({ blockedModuleVersion: '0.9.0' });
    h.answer.status = 202;
    h.clock.now += 2 * DAY;
    await h.scheduler.tick();
    expect(h.requests).toHaveLength(2);
  });

  describe('Send now', () => {
    it('sends at once, then refuses for 10 minutes', async () => {
      const result = await h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS);
      expect(result.row.status).toBe('sent');
      await expect(h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS)).rejects.toMatchObject({ code: 'rate_limited' });
      h.clock.now += STATS_SEND_NOW_INTERVAL_MS + 1;
      await h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS);
      expect(h.requests).toHaveLength(2);
    });

    it('is refused while the switch is off', async () => {
      await h.instance.setStatsEnabledUi('operator', false);
      await expect(h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS)).rejects.toBeInstanceOf(SendNowRefused);
      await expect(h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS)).rejects.toMatchObject({ code: 'stats_disabled' });
      expect(h.requests).toHaveLength(0);
    });

    it('sends once when pressed twice at the same time', async () => {
      const results = await Promise.allSettled([h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS), h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS)]);
      expect(results.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      expect(h.requests).toHaveLength(1);
    });

    it('is refused while another process holds the lease', async () => {
      await h.dataSource
        .getRepository(EverStatsLease)
        .update({ owner: 'stats' }, { leasedBy: 'another-process', leaseUntil: new Date(h.clock.now + 60_000) });
      await expect(h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS)).rejects.toMatchObject({ code: 'busy' });
      expect(h.requests).toHaveLength(0);
    });
  });

  it('switching off waits for a report being sent in this process', async () => {
    let release: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    const order: string[] = [];
    const send = h.sender.send.bind(h.sender);
    const spy = jest.spyOn(h.sender, 'send').mockImplementation(async input => {
      await gate;
      order.push('sent');
      return send(input);
    });
    const slot = h.scheduler.tick();
    while (!spy.mock.calls.length) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const off = h.scheduler.setEnabled('operator', false).then(() => order.push('switched off'));
    await flush(50);
    release();
    await Promise.all([slot, off]);
    expect(order).toEqual(['sent', 'switched off']);
    expect(await h.instance.isStatsEnabledUi()).toBe(false);
  });

  it('a reset of the identity starts a new series: new id and key, history and refusal forgotten', async () => {
    h.answer.status = 422;
    await h.scheduler.tick();
    const before = await h.instance.ensure();
    expect(await reports()).toHaveLength(1);
    const after = await h.scheduler.resetIdentity('operator');
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(await reports()).toEqual([]);
    expect((await schedule()).blockedModuleVersion).toBeNull();
    h.answer.status = 202;
    await h.scheduler.sendNow(STATS_SEND_NOW_INTERVAL_MS);
    const last = h.requests[h.requests.length - 1];
    expect(JSON.parse(last.body.toString()).instance_id).toBe(after.instanceId);
    expect(last.headers['Ever-Stats-Key']).toBe(after.statsPublicKey);
  });

  it('resets the identity by itself when TR_SECRET changed, so the platform never sees a second key for one id', async () => {
    const before = await h.instance.ensure();
    config.secret = 'a-new-secret-'.padEnd(64, 'n');
    await h.scheduler.tick();
    const after = await h.instance.ensure();
    expect(after.instanceId).not.toBe(before.instanceId);
    expect(after.resetCount).toBe(1);
    expect(sentPeriods()[0].instance_id).toBe(after.instanceId);
  });
});
