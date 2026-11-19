import { DataSource } from 'typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { EverStatsSchedule } from '../entity/ever-stats-schedule.entity';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { EverStatsConfig } from './ever-stats.config';
import { EverStatsScheduleStore } from './ever-stats-schedule.store';
import { EverStatsSchedulerService, SendNowRefused } from './ever-stats-scheduler.service';
import { EverStatsSenderService } from './ever-stats-sender.service';

const CONFIG: EverStatsConfig = {
  apiUrl: 'http://mock-platform:8080',
  country: 'ZZ',
  intervalS: 86400,
  installSource: 'self-hosted',
  release: { version: '0.23.0', channel: 'stable' },
  features: { google_login: false, signups_enabled: true },
};

const DAY = 86400000;

describe('EverStatsSchedulerService', () => {
  let dataSource: DataSource;
  let instance: EverInstanceService;
  let sends: Array<{ period: string; final: boolean }>;
  let status: string;
  let now: number;
  let scheduler: EverStatsSchedulerService;

  const fakeSender = {
    send: async (input: { period: string; final: boolean }) => {
      sends.push(input);
      const row = new EverStatsReport();
      row.reportId = `r-${sends.length}`;
      row.period = input.period;
      row.final = input.final;
      row.status = status;
      row.retry = status === 'failed' ? 'backoff' : 'none';
      return row;
    },
    clearReports: async () => undefined,
  } as unknown as EverStatsSenderService;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [EverInstance, EverStatsSchedule], synchronize: true });
    await dataSource.initialize();
    instance = new EverInstanceService(dataSource.getRepository(EverInstance), {
      installSource: 'self-hosted',
      adminEmails: [],
      secret: 'unit-test-secret-of-this-installation',
    });
    await instance.ensure();
    sends = [];
    status = 'sent';
    now = Date.UTC(2026, 10, 19, 12);
    scheduler = new EverStatsSchedulerService(dataSource.getRepository(EverStatsSchedule), CONFIG, () => now, instance, fakeSender, false);
  });

  afterEach(async () => {
    scheduler.onModuleDestroy();
    await dataSource.destroy();
  });

  it('sends the running month at its slot and plans the next day', async () => {
    await scheduler.tick();
    expect(sends).toEqual([{ period: '2026-11', final: false }]);
    const row = await scheduler.schedule.read();
    expect(row.lastStatus).toBe('sent');
    expect(row.lastSentAt).toBe(now);
    expect(row.nextSendAt).toBeGreaterThanOrEqual(Date.UTC(2026, 10, 20));
    expect(row.nextSendAt).toBeLessThan(Date.UTC(2026, 10, 21));
    expect(row.leasedBy).toBeNull();
  });

  it('closes the previous month once on day 2', async () => {
    now = Date.UTC(2026, 11, 2, 8);
    await scheduler.tick();
    expect(sends).toEqual([
      { period: '2026-11', final: true },
      { period: '2026-12', final: false },
    ]);
    expect((await scheduler.schedule.read()).lastFinalSentFor).toBe('2026-11');
    sends = [];
    // The next slot falls on day 3: the closed month is not sent again
    now = (await scheduler.schedule.read()).nextSendAt;
    expect(new Date(now).getUTCDate()).toBe(3);
    await scheduler.tick();
    expect(sends).toEqual([{ period: '2026-12', final: false }]);
  });

  it('sends nothing while the operator turned the statistics off', async () => {
    await instance.setStatsEnabledUi('user-1', false);
    await scheduler.tick();
    expect(sends).toEqual([]);
  });

  it('sends nothing while another process holds the lease', async () => {
    const other = new EverStatsScheduleStore(dataSource.getRepository(EverStatsSchedule), 5 * 60 * 1000);
    expect(await other.acquire(now)).toBe(true);
    await scheduler.tick();
    expect(sends).toEqual([]);
    // Once the other process's lease has expired, this one may send
    now += 6 * 60 * 1000;
    await scheduler.tick();
    expect(sends).toHaveLength(1);
  });

  it('backs off after a failure: +1 h, +4 h, +12 h, then the next day', async () => {
    status = 'failed';
    const waits: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      await scheduler.tick();
      const row = await scheduler.schedule.read();
      waits.push(row.nextSendAt - now);
      now = row.nextSendAt;
    }
    expect(waits.slice(0, 3)).toEqual([3600000, 14400000, 43200000]);
    expect(waits[3]).toBeGreaterThan(0);
  });

  it('plans the first report a day after the first start, or soon when one is overdue', async () => {
    expect(await scheduler.firstDue(now)).toBe(now + DAY);
    await scheduler.schedule.patch({ nextSendAt: null, lastSentAt: now - 2 * DAY });
    expect(await scheduler.firstDue(now)).toBe(now + 10 * 60 * 1000);
  });

  it('refuses Send now while the statistics are off, and more than once per 10 minutes', async () => {
    await instance.setStatsEnabledUi('user-1', false);
    await expect(scheduler.sendNow(600000)).rejects.toBeInstanceOf(SendNowRefused);
    await expect(scheduler.sendNow(600000)).rejects.toMatchObject({ reason: 'stats_disabled' });
    await instance.setStatsEnabledUi('user-1', true);
    await scheduler.sendNow(600000);
    expect(sends).toHaveLength(1);
    now += 60000;
    await expect(scheduler.sendNow(600000)).rejects.toMatchObject({ reason: 'rate_limited' });
    now += 600000;
    await scheduler.sendNow(600000);
    expect(sends).toHaveLength(2);
  });

  it('stops sending after Ever Platform refused this module version', async () => {
    await scheduler.schedule.patch({ blockedModuleVersion: '1.0.0' });
    await scheduler.tick();
    expect(sends).toEqual([]);
    await expect(scheduler.sendNow(600000)).rejects.toMatchObject({ reason: 'refused_until_upgrade' });
    await scheduler.afterIdentityReset();
    now = (await scheduler.schedule.read()).nextSendAt;
    await scheduler.tick();
    expect(sends).toHaveLength(1);
  });
});
