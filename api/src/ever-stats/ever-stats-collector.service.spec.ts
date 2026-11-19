import { FindOperator } from 'typeorm';
import { EverStatsCollectorService } from './ever-stats-collector.service';
import { EverStatsConfig } from './ever-stats.config';

const CONFIG: EverStatsConfig = {
  apiUrl: 'http://mock-platform:8080',
  country: 'DE',
  intervalS: 86400,
  installSource: 'self-hosted',
  release: { version: '0.23.0', channel: 'stable' },
  features: { google_login: true, signups_enabled: false },
};

/** A repository that answers `count()` with `total`, and records the options it was asked with. */
const countingRepo = (total: number, calls: unknown[] = []) => ({
  count: async (options?: unknown) => {
    calls.push(options);
    return total;
  },
});

describe('EverStatsCollectorService', () => {
  const translationCalls: any[] = [];
  const collector = new EverStatsCollectorService(
    CONFIG,
    countingRepo(3) as any,
    countingRepo(2) as any,
    countingRepo(40) as any,
    {
      count: async (options?: any) => {
        translationCalls.push(options);
        return options ? 7 : 75;
      },
    } as any,
    countingRepo(4) as any,
    countingRepo(1) as any,
  );

  it('builds a report the published schema accepts, from counts and switches only', async () => {
    const report = await collector.build({
      instanceId: '0572c446-d926-40de-b433-b331dac9a11a',
      period: '2026-11',
      final: false,
      now: Date.UTC(2026, 10, 19, 15),
    });
    expect(report.error).toBeNull();
    expect(report.report).toMatchObject({
      schema: 'ever.stats.v1',
      product: 'traduora',
      instance_kind: 'backend',
      serves: ['traduora'],
      sent_at: '2026-11-19',
      period: '2026-11',
      final: false,
      version: '0.23.0',
      channel: 'stable',
      install_source: 'self-hosted',
      country: 'DE',
      module_version: '1.0.0',
      counts: { users: 3, projects: 2, terms: 40, translations: 75, locales: 4, project_clients: 1 },
      features: { google_login: true, signups_enabled: false },
      aggregates: { translations_changed: 7 },
    });
    expect(report.text).toBe(JSON.stringify(report.report));
    expect(report.bytes.equals(Buffer.from(report.text, 'utf8'))).toBe(true);
  });

  it('counts the translations changed within the UTC month only', async () => {
    translationCalls.length = 0;
    await collector.readCounters('2026-11');
    const withPeriod = translationCalls.find(call => call && call.where);
    const modified: FindOperator<Date> = withPeriod.where.date.modified;
    const bounds = (modified.value as unknown as FindOperator<Date>[]).map(op => [op.type, (op.value as Date).toISOString()]);
    expect(bounds).toEqual([
      ['moreThanOrEqual', '2026-11-01T00:00:00.000Z'],
      ['lessThan', '2026-12-01T00:00:00.000Z'],
    ]);
  });

  it('crosses the year correctly', async () => {
    translationCalls.length = 0;
    await collector.readCounters('2026-12');
    const withPeriod = translationCalls.find(call => call && call.where);
    const ops = withPeriod.where.date.modified.value as FindOperator<Date>[];
    expect((ops[1].value as Date).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('never sends a negative, fractional or huge count', () => {
    const report = collector.assemble({
      instanceId: '0572c446-d926-40de-b433-b331dac9a11a',
      period: '2026-11',
      final: true,
      now: Date.UTC(2026, 10, 2),
      counters: { users: -1, projects: 2.7, terms: 5e12, translations: NaN, locales: 0, projectClients: 1, translationsChanged: 0 },
    });
    expect(report.counts).toEqual({ users: 0, projects: 2, terms: 1000000000, translations: 0, locales: 0, project_clients: 1 });
    expect(collector.check(report).error).toBeNull();
  });
});
