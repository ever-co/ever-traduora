import { DataSource } from 'typeorm';
import { config } from '../src/config';
import { EverInstance } from '../src/entity/ever-instance.entity';
import { EverStatsLease } from '../src/entity/ever-stats-lease.entity';
import { EverStatsReport } from '../src/entity/ever-stats-report.entity';
import { EverStatsSchedule } from '../src/entity/ever-stats-schedule.entity';
import { ProjectClient } from '../src/entity/project-client.entity';
import { ProjectLocale } from '../src/entity/project-locale.entity';
import { Project } from '../src/entity/project.entity';
import { Term } from '../src/entity/term.entity';
import { Translation } from '../src/entity/translation.entity';
import { User } from '../src/entity/user.entity';
import { EverInstanceService } from '../src/ever-instance/ever-instance.service';
import { EverStatsSettings } from '../src/ever-stats/ever-stats.settings';
import { EverStatsCollectorService } from '../src/ever-stats/ever-stats-collector.service';
import { EverStatsSchedulerService } from '../src/ever-stats/ever-stats-scheduler.service';
import { EverStatsSenderService, StatsFetch } from '../src/ever-stats/ever-stats-sender.service';
import { memoryDatabase } from './memory-database';

/** One recorded request of the fake HTTP client. */
export interface RecordedRequest {
  url: string;
  headers: Record<string, string>;
  body: Buffer;
}

/** The statistics services of one API process, on a database of the test, with a clock and an HTTP client it controls. */
export interface StatsProcess {
  instance: EverInstanceService;
  collector: EverStatsCollectorService;
  sender: EverStatsSenderService;
  scheduler: EverStatsSchedulerService;
}

export interface StatsHarness extends StatsProcess {
  dataSource: DataSource;
  settings: EverStatsSettings;
  clock: { now: number };
  requests: RecordedRequest[];
  /** The status the fake platform answers next (or a function of the request; `null` = no answer). */
  answer: { status: number | null | ((request: RecordedRequest) => number | null) };
  /** Another API process on the same database (its own send lock and lease holder). */
  newProcess(): StatsProcess;
  close(): Promise<void>;
}

export const TEST_SETTINGS = (): EverStatsSettings => ({
  apiUrl: 'http://127.0.0.1:9',
  country: 'ZZ',
  intervalS: 86400,
  installSource: 'self-hosted',
  release: { version: '0.23.0', channel: 'stable' },
  features: () => ({ google_login: false, signups_enabled: true }),
});

/**
 * The statistics services wired by hand on an in-memory SQLite database with every migration applied, a clock the
 * test sets, and a fake HTTP client that records each request and answers `answer.status`. TR_SECRET is set for the
 * test (restored by `close()`).
 */
export async function statsHarness(overrides: Partial<EverStatsSettings> = {}): Promise<StatsHarness> {
  const original = { secret: config.secret, everPlatform: { ...config.everPlatform } };
  config.secret = 'the-secret-of-this-test-'.padEnd(64, 's');
  config.everPlatform.secretConfigured = true;
  const dataSource = await memoryDatabase();
  const settings = { ...TEST_SETTINGS(), ...overrides };
  const clock = { now: Date.parse('2026-11-15T12:00:00Z') };
  const requests: RecordedRequest[] = [];
  const answer: StatsHarness['answer'] = { status: 202 };
  const fetchFn: StatsFetch = async (url, init) => {
    const request = { url, headers: init.headers, body: Buffer.from(init.body) };
    requests.push(request);
    const status = typeof answer.status === 'function' ? answer.status(request) : answer.status;
    if (status === null) {
      throw new Error('connection refused');
    }
    return { status };
  };
  const now = () => clock.now;
  const newProcess = (): StatsProcess => {
    const instance = new EverInstanceService(dataSource.getRepository(EverInstance));
    const collector = new EverStatsCollectorService(
      dataSource.getRepository(User),
      dataSource.getRepository(Project),
      dataSource.getRepository(Term),
      dataSource.getRepository(Translation),
      dataSource.getRepository(ProjectLocale),
      dataSource.getRepository(ProjectClient),
      settings,
    );
    const sender = new EverStatsSenderService(dataSource.getRepository(EverStatsReport), settings, now, fetchFn, instance, collector);
    const scheduler = new EverStatsSchedulerService(
      dataSource.getRepository(EverStatsSchedule),
      dataSource.getRepository(EverStatsLease),
      settings,
      now,
      instance,
      sender,
      false,
    );
    scheduler.drainWaitMs = 200;
    return { instance, collector, sender, scheduler };
  };
  const first = newProcess();
  return {
    ...first,
    dataSource,
    settings,
    clock,
    requests,
    answer,
    newProcess,
    async close() {
      first.scheduler.onModuleDestroy();
      config.secret = original.secret;
      Object.assign(config.everPlatform, original.everPlatform);
      await dataSource.destroy();
    },
  };
}
