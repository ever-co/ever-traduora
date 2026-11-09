import { loadStatsSchema } from '../ever-stats-validator';

type Node = { [key: string]: unknown };
const isObject = (v: unknown): v is Node => v !== null && typeof v === 'object' && !Array.isArray(v);
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The allow-list rules the vendored schema must keep, whatever its content:
 * - every object level is closed: `additionalProperties: false`, or a map whose keys are bound by `propertyNames`
 *   with a pattern and whose size is bound by `maxProperties`;
 * - every string is bound: `const`, `enum`, or `pattern` with `maxLength` at most 64.
 */
export function metaViolations(schema: unknown, path = '#'): string[] {
  const out: string[] = [];
  const visit = (node: unknown, at: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${at}/${i}`));
      return;
    }
    if (!isObject(node)) return;
    if (node.type === 'object' && node.additionalProperties !== false) {
      const names = node.propertyNames;
      const boundMap = isObject(names) && typeof names.pattern === 'string' && typeof node.maxProperties === 'number';
      if (!boundMap) out.push(`${at}: object not closed`);
    }
    if (node.type === 'string') {
      const bound =
        'const' in node ||
        Array.isArray(node.enum) ||
        (typeof node.pattern === 'string' && typeof node.maxLength === 'number' && (node.maxLength as number) <= 64);
      if (!bound) out.push(`${at}: string not bound`);
    }
    if (Array.isArray(node.enum) && !(node.enum as unknown[]).every(v => typeof v === 'string' && v.length <= 64)) {
      out.push(`${at}: enum value not a short string`);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'description' || key === '$comment') continue;
      visit(value, `${at}/${key}`);
    }
  };
  visit(schema, path);
  return out;
}

describe('ever.stats.v1 schema allow-list rules', () => {
  const schema = loadStatsSchema();

  it('closes every object (additionalProperties: false at every level) and bounds every string', () => {
    expect(metaViolations(schema)).toEqual([]);
  });

  it('keeps the closed Traduora lists', () => {
    const traduora = (schema as any).$defs.traduora;
    expect(Object.keys(traduora.counts.properties).sort(byText)).toEqual([
      'locales',
      'project_clients',
      'projects',
      'terms',
      'translations',
      'users',
    ]);
    expect(Object.keys(traduora.features.properties).sort(byText)).toEqual(['google_login', 'signups_enabled']);
    expect(Object.keys(traduora.aggregates.properties).sort(byText)).toEqual(['translations_changed']);
  });

  it('fails when one level is opened (control)', () => {
    const copy = JSON.parse(JSON.stringify(schema));
    delete copy.$defs.traduora.counts.additionalProperties;
    expect(metaViolations(copy)).toEqual(['#/$defs/traduora/counts: object not closed']);
  });

  it('fails when a string is unbounded (control)', () => {
    const copy = JSON.parse(JSON.stringify(schema));
    delete copy.properties.version.pattern;
    expect(metaViolations(copy)).toEqual(['#/properties/version: string not bound']);
  });
});
