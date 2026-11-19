import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { EverStatsCollectorService, StatsCounters } from './ever-stats-collector.service';
import { EverStatsConfig } from './ever-stats.config';
import { loadStatsSchema, StatsValidator, strictParse } from './ever-stats-validator';

const SCHEMA_DIR = join(__dirname, 'schema');
const fixture = (path: string) => readFileSync(join(SCHEMA_DIR, 'fixtures', path));

const CONFIG: EverStatsConfig = {
  apiUrl: 'http://mock-platform:8080',
  country: 'ZZ',
  intervalS: 86400,
  installSource: 'self-hosted',
  release: { version: '0.23.0', channel: 'stable' },
  features: { google_login: false, signups_enabled: true },
};

const COUNTERS: StatsCounters = { users: 3, projects: 2, terms: 40, translations: 75, locales: 4, projectClients: 1, translationsChanged: 12 };

const collector = () => new EverStatsCollectorService(CONFIG, null, null, null, null, null, null);

const built = (overrides: Record<string, unknown> = {}) => ({
  ...collector().assemble({
    instanceId: '0572c446-d926-40de-b433-b331dac9a11a',
    period: '2026-11',
    final: false,
    counters: COUNTERS,
    now: Date.UTC(2026, 10, 2),
  }),
  ...overrides,
});

const bytesOf = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8');

describe('anonymous statistics allow-list', () => {
  const validator = new StatsValidator();

  it('stats_payload_builder_matches_published_schema', () => {
    const check = validator.checkBytes(bytesOf(built()), 'traduora');
    expect(check.errors).toBeUndefined();
    expect(check.ok).toBe(true);
  });

  it('accepts the published Traduora example', () => {
    expect(validator.checkBytes(fixture('valid/traduora.json'), 'traduora').ok).toBe(true);
  });

  it('builds exactly the keys of the published Traduora example', () => {
    const example = JSON.parse(fixture('valid/traduora.json').toString('utf8'));
    const report = built();
    expect(Object.keys(report).sort()).toEqual(Object.keys(example).sort());
    for (const section of ['counts', 'features', 'aggregates']) {
      expect(Object.keys(report[section] as object).sort()).toEqual(Object.keys(example[section]).sort());
    }
  });

  it('refuses every published invalid example with the status, path and error Ever Platform gives', () => {
    const expected = JSON.parse(fixture('expected.json').toString('utf8')).fixtures;
    const names = readdirSync(join(SCHEMA_DIR, 'fixtures', 'invalid')).filter(name => name.endsWith('.json'));
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const check = validator.checkBytes(fixture(`invalid/${name}`));
      const want = expected[`invalid/${name}`];
      expect({ name, ok: check.ok, status: check.status, path: check.errors[0].path, error: check.errors[0].code }).toEqual({
        name,
        ok: false,
        status: want.status,
        path: want.path,
        error: want.error,
      });
    }
  });

  it('refuses a field outside the allow-list, such as an e-mail count', () => {
    const report = built();
    const check = validator.checkBytes(bytesOf({ ...report, counts: { ...(report.counts as object), emails: 1 } }), 'traduora');
    expect(check.ok).toBe(false);
    expect(check.errors).toContainEqual({ path: '/counts/emails', code: 'unknown_field' });
  });

  it('refuses free text where a closed value is expected', () => {
    expect(validator.checkBytes(bytesOf(built({ country: 'someone@example.com' })), 'traduora').ok).toBe(false);
    expect(validator.checkBytes(bytesOf(built({ version: '0.23.0-acme' })), 'traduora').ok).toBe(false);
    expect(validator.checkBytes(bytesOf(built({ install_source: 'https://example.com' })), 'traduora').ok).toBe(false);
  });

  it('refuses the report of another product', () => {
    expect(validator.checkBytes(bytesOf(built()), 'rec').ok).toBe(false);
  });

  it('closes every object of the schema (additionalProperties: false)', () => {
    const open: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (Array.isArray(node)) {
        node.forEach((item, i) => walk(item, `${path}/${i}`));
        return;
      }
      if (node === null || typeof node !== 'object') return;
      const schema = node as Record<string, unknown>;
      if (schema.type === 'object' && schema.additionalProperties !== false && typeof schema.additionalProperties !== 'object') {
        open.push(path);
      }
      for (const [key, value] of Object.entries(schema)) walk(value, `${path}/${key}`);
    };
    walk(loadStatsSchema(), '');
    expect(open).toEqual([]);
  });

  it('places every string of a built report at a path the schema binds', () => {
    expect(validator.walkStrings(built())).toEqual([]);
  });

  it('reads JSON strictly', () => {
    expect(() => strictParse(Buffer.from('{"a":1,"a":2}'))).toThrow();
    expect(() => strictParse(Buffer.from('{"a":1.5}'))).toThrow();
    expect(() => strictParse(Buffer.from('{"a":1e3}'))).toThrow();
    expect(() => strictParse(Buffer.from('{"a":99999999999999999999}'))).toThrow();
    // At most 16 levels, empty containers included
    expect(() => strictParse(Buffer.from('['.repeat(16) + ']'.repeat(16)))).not.toThrow();
    expect(() => strictParse(Buffer.from('['.repeat(17) + ']'.repeat(17)))).toThrow();
    expect(() => strictParse(Buffer.from('{"a":'.repeat(16) + '{}' + '}'.repeat(16)))).toThrow();
    expect(strictParse(Buffer.from('{"a":[1,true,null,"x"]}'))).toEqual({ a: [1, true, null, 'x'] });
  });

  it('never lets a failed report through and names the field without its value', () => {
    const result = collector().check(built({ country: 'someone@example.com' }));
    expect(result.error).toMatch(/^schema_violation:\/country:/);
    expect(result.error).not.toContain('someone');
  });
});
