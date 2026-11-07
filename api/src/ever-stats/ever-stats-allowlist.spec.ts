import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { describeOnSqlite } from '../../test/memory-database';
import { StatsHarness, statsHarness } from '../../test/ever-stats-unit';
import { verifyBytes } from '../ever-instance/key-wrap';
import { loadStatsSchema, StatsValidator } from './ever-stats-validator';

const FIXTURES = join(__dirname, 'schema', 'fixtures');
const expected = JSON.parse(readFileSync(join(FIXTURES, 'expected.json'), 'utf8')).fixtures as Record<
  string,
  { status: number; path?: string; error?: string }
>;
const invalid = readdirSync(join(FIXTURES, 'invalid'))
  .filter(name => name.endsWith('.json'))
  .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const bytesOf = (rel: string) => readFileSync(join(FIXTURES, rel));
const golden = () => JSON.parse(bytesOf('valid/traduora.json').toString('utf8'));

describe('statistics report validator', () => {
  const validator = new StatsValidator();

  it('accepts the Traduora golden fixture', () => {
    expect(validator.checkBytes(bytesOf('valid/traduora.json'), 'traduora')).toEqual({ ok: true, report: golden() });
  });

  it('has the thirteen invalid fixtures', () => {
    expect(invalid).toHaveLength(13);
  });

  it.each(invalid)('rejects invalid/%s with the path and code the platform answers', name => {
    const want = expected[`invalid/${name}`];
    const result = validator.checkBytes(bytesOf(`invalid/${name}`));
    expect(result.ok).toBe(false);
    expect(result.status).toBe(want.status);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.map(error => error.path)).toContain(want.path);
    expect(result.errors.find(error => error.path === want.path)?.code).toBe(want.error);
  });

  it('refuses a valid report of another product for Traduora', () => {
    const report = golden();
    report.product = 'rec';
    report.serves = ['rec'];
    report.counts = { users: 1, workspaces: 1, teams: 1 };
    report.features = { gauzy_mirror: false, google_login: false };
    report.aggregates = { screenshots: 1, videos: 1, storage_mb: 1 };
    const bytes = Buffer.from(JSON.stringify(report));
    expect(validator.checkBytes(bytes).ok).toBe(true);
    expect(validator.checkBytes(bytes, 'traduora')).toEqual({ ok: false, status: 422, errors: [{ path: '/product', code: 'pattern' }] });
  });

  it('refuses a Traduora report that carries a key of another product, or one more key', () => {
    const report = golden();
    report.counts.workspaces = 3;
    expect(validator.checkBytes(Buffer.from(JSON.stringify(report)), 'traduora').errors).toContainEqual({
      path: '/counts/workspaces',
      code: 'unknown_field',
    });
    const withEmails = golden();
    withEmails.counts.emails = 3;
    expect(validator.checkBytes(Buffer.from(JSON.stringify(withEmails)), 'traduora').ok).toBe(false);
  });

  it('refuses a day that does not exist', () => {
    const report = golden();
    report.sent_at = '2026-02-30';
    expect(validator.checkBytes(Buffer.from(JSON.stringify(report)), 'traduora')).toEqual({
      ok: false,
      status: 422,
      errors: [{ path: '/sent_at', code: 'range' }],
    });
  });

  describe('string walker', () => {
    it('passes the golden fixture', () => {
      expect(validator.walkStrings(golden())).toEqual([]);
    });

    it('catches free text the schema pass would miss (control: a schema that lost a pattern)', () => {
      const schema = loadStatsSchema();
      delete schema.properties.country.pattern;
      const weakened = new StatsValidator(schema);
      const report = golden();
      report.country = 'jo';
      expect(weakened.schemaErrors(report)).toEqual([]);
      expect(weakened.walkStrings(report)).toEqual([{ path: '/country', code: 'pattern' }]);
      expect(weakened.checkBytes(Buffer.from(JSON.stringify(report)), 'traduora').ok).toBe(false);
    });

    it('names an unknown key wherever it stands', () => {
      const report = golden();
      report.counts.owner_email = 'someone@example.test';
      expect(validator.walkStrings(report)).toEqual([{ path: '/counts/owner_email', code: 'unknown_field' }]);
    });
  });

  it('redacts unknown segments of a path', () => {
    expect(validator.redactPath('/counts/someone@example.test')).toBe('/counts/*');
    expect(validator.redactPath('/counts/users')).toBe('/counts/users');
    expect(validator.redactPath('')).toBe('');
  });
});

describeOnSqlite('statistics report of this installation', () => {
  let h: StatsHarness;

  beforeEach(async () => {
    h = await statsHarness();
  });

  afterEach(async () => {
    await h.close();
  });

  it('stats_payload_builder_matches_published_schema', async () => {
    const record = await h.instance.ensure();
    const built = await h.collector.build({ instanceId: record.instanceId, period: '2026-11', final: true, now: h.clock.now });
    expect(built.check).toEqual({ ok: true, report: built.report });
    expect(h.collector.validator.walkStrings(built.report)).toEqual([]);
    // Every string sits at an allow-listed path, bound by a fixed format
    const strings: string[] = [];
    const walk = (value: unknown, path: string) => {
      if (typeof value === 'string') strings.push(path);
      else if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}/${i}`));
      else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => walk(item, `${path}/${key}`));
    };
    walk(built.report, '');
    expect(strings.sort()).toEqual(
      [
        '/schema',
        '/report_id',
        '/instance_id',
        '/sent_at',
        '/module_version',
        '/product',
        '/instance_kind',
        '/serves/0',
        '/version',
        '/channel',
        '/install_source',
        '/country',
        '/period',
      ].sort(),
    );
  });

  it('carries the statistics public key of ever_instance in Ever-Stats-Key, and the signature verifies', async () => {
    await h.sender.send({ period: '2026-11', final: false });
    const record = await h.instance.ensure();
    const [request] = h.requests;
    expect(request.headers['Ever-Stats-Key']).toBe(record.statsPublicKey);
    expect(Buffer.from(record.statsPublicKey, 'base64url')).toHaveLength(32);
    const signature = Buffer.from(request.headers['Ever-Stats-Signature'].replace(/^ed25519=/, ''), 'base64url');
    expect(signature).toHaveLength(64);
    expect(verifyBytes(record.statsPublicKey, request.body, signature)).toBe(true);
  });
});
