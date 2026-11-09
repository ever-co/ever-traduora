import { readFileSync } from 'fs';
import { join } from 'path';
import { describeOnSqlite } from '../../test/memory-database';
import { StatsHarness, statsHarness } from '../../test/ever-stats-unit';
import { Locale } from '../entity/locale.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import { User } from '../entity/user.entity';
import { parseReleaseVersion } from './ever-stats.settings';

const golden = JSON.parse(readFileSync(join(__dirname, 'schema', 'fixtures', 'valid', 'traduora.json'), 'utf8'));
const strip = (report: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(report).filter(([key]) => !['report_id', 'sent_at', 'instance_id'].includes(key)));

describe('release version', () => {
  it('sends major.minor.patch only and maps a suffix to the channel', () => {
    expect(parseReleaseVersion('0.23.0')).toEqual({ version: '0.23.0', channel: 'stable' });
    expect(parseReleaseVersion('v1.2.3-rc.1')).toEqual({ version: '1.2.3', channel: 'rc' });
    expect(parseReleaseVersion('1.2.3-beta.2')).toEqual({ version: '1.2.3', channel: 'beta' });
    expect(parseReleaseVersion('1.2.3-dev')).toEqual({ version: '1.2.3', channel: 'dev' });
    expect(parseReleaseVersion('1.2.3-12-gabcdef1')).toEqual({ version: '1.2.3', channel: 'dev' });
    expect(parseReleaseVersion('1.2.3-acme-corp')).toEqual({ version: '1.2.3', channel: 'custom' });
    expect(parseReleaseVersion('not a version')).toEqual({ version: '0.0.0', channel: 'dev' });
  });
});

describeOnSqlite('EverStatsCollectorService', () => {
  let h: StatsHarness;

  beforeEach(async () => {
    h = await statsHarness();
  });

  afterEach(async () => {
    await h.close();
  });

  const repo = <T>(entity: new () => T) => h.dataSource.getRepository(entity);

  /** A user, a project with one locale, `terms` terms and one translation each. */
  const seed = async (terms: number) => {
    const user = await repo(User).save(repo(User).create({ name: 'Seed', email: `seed-${Math.random()}@example.test` }));
    const project = await repo(Project).save(repo(Project).create({ name: 'Seed project' }));
    const locale = await repo(Locale).findOneOrFail({ where: { code: 'de_DE' } });
    const projectLocale = await repo(ProjectLocale).save(repo(ProjectLocale).create({ project, locale }));
    const saved: Translation[] = [];
    for (let i = 0; i < terms; i++) {
      const term = await repo(Term).save(repo(Term).create({ value: `term.${i}`, project }));
      saved.push(await repo(Translation).save(repo(Translation).create({ term, projectLocale, value: `value ${i}` })));
    }
    await repo(ProjectClient).save(
      repo(ProjectClient).create({ name: 'client', project, role: 'viewer' as any, encryptedSecret: Buffer.from('not a real secret') }),
    );
    return { user, project, translations: saved };
  };

  const setModified = (translation: Translation, when: string) =>
    repo(Translation)
      .createQueryBuilder()
      .update(Translation)
      .set({ date: { modified: new Date(when) } } as any)
      .where('term_id = :term AND project_locale_id = :locale', { term: translation.termId, locale: translation.projectLocaleId })
      .execute();

  it('builds a report that passes every check of the published schema', async () => {
    await seed(3);
    const record = await h.instance.ensure();
    const built = await h.collector.build({ instanceId: record.instanceId, period: '2026-11', final: false, now: h.clock.now });
    expect(built.error).toBeNull();
    expect(built.check.ok).toBe(true);
    expect(built.report).toMatchObject({
      schema: 'ever.stats.v1',
      instance_id: record.instanceId,
      sent_at: '2026-11-15',
      product: 'traduora',
      period: '2026-11',
      final: false,
      counts: { users: 1, projects: 1, terms: 3, translations: 3, locales: 1, project_clients: 1 },
      features: { google_login: false, signups_enabled: true },
    });
    expect(built.text).toBe(JSON.stringify(built.report));
    expect(built.bytes.equals(Buffer.from(built.text))).toBe(true);
  });

  it('counts the translations modified in the UTC month only', async () => {
    const { translations } = await seed(4);
    await setModified(translations[0], '2026-10-31T23:59:59.999Z');
    await setModified(translations[1], '2026-11-01T00:00:00.000Z');
    await setModified(translations[2], '2026-11-30T23:59:59.000Z');
    await setModified(translations[3], '2026-12-01T00:00:00.000Z');
    expect((await h.collector.readNumbers('2026-11')).translationsChanged).toBe(2);
    expect((await h.collector.readNumbers('2026-10')).translationsChanged).toBe(1);
    expect((await h.collector.readNumbers('2026-12')).translationsChanged).toBe(1);
  });

  it('matches the published Traduora golden fixture, but for report_id, sent_at and instance_id', () => {
    Object.assign(h.settings, {
      release: parseReleaseVersion(golden.version),
      installSource: golden.install_source,
      country: golden.country,
      features: () => golden.features,
    });
    const report = h.collector.assemble({
      instanceId: '00000000-0000-4000-8000-000000000000',
      period: golden.period,
      final: golden.final,
      now: Date.parse(`${golden.period}-15T12:00:00Z`),
      numbers: {
        users: golden.counts.users,
        projects: golden.counts.projects,
        terms: golden.counts.terms,
        translations: golden.counts.translations,
        locales: golden.counts.locales,
        projectClients: golden.counts.project_clients,
        translationsChanged: golden.aggregates.translations_changed,
      },
    });
    expect(strip(report)).toEqual(strip(golden));
    // Same key order as the fixture: the bytes differ only in the three fields
    expect(Object.keys(report)).toEqual(Object.keys(golden));
    expect(h.collector.check(report).error).toBeNull();
  });

  it('never builds a report the schema refuses (an extra key, a value out of range)', () => {
    const report = h.collector.assemble({
      instanceId: '00000000-0000-4000-8000-000000000000',
      period: '2026-11',
      final: false,
      now: h.clock.now,
      numbers: { users: 1, projects: 1, terms: 1, translations: 1, locales: 1, projectClients: 1, translationsChanged: 1 },
    });
    (report.counts as Record<string, unknown>).emails = 3;
    expect(h.collector.check(report).error).toBe('schema_violation:/counts/*:unknown_field');
    delete (report.counts as Record<string, unknown>).emails;
    report.country = 'Germany';
    expect(h.collector.check(report).error).toMatch(/^schema_violation:\/country:/);
  });
});
