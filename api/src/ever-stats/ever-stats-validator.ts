/**
 * The checks a statistics report passes before it is signed, run on the exact bytes that would be sent, in the order the
 * receiving side runs them, so a report this module lets through is one Ever Platform accepts:
 *
 * 1. the size limit (16 KiB): `413`, `too_large`;
 * 2. a strict JSON reader: no number with a fraction or an exponent, no integer outside 64 bits, no key twice in one
 *    object, at most 16 levels;
 * 3. the vendored `ever.stats.v1` schema with `ajv` in strict mode, in two passes: the envelope, then the product's own
 *    closed lists, so a key of another product is named where it stands;
 * 4. the string walker: every string (and every map key) sits at a path the schema declares and is bound there by
 *    `const`, `enum`, or a `pattern` with `maxLength` at most 64;
 * 5. `sent_at` names a day that exists;
 * 6. for this module's own reports, `product` is `traduora`.
 *
 * A refusal names a JSON pointer and a code, never a value of the report.
 */
import Ajv2020, { ErrorObject, ValidateFunction } from 'ajv/dist/2020';
import { MAX_STATS_REPORT_BYTES } from './ever-stats.constants';
import * as VENDORED_SCHEMA from './schema/ever.stats.v1.json';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
interface Schema {
  [key: string]: any;
}

export const STATS_ERROR_CODES = ['unknown_field', 'type', 'pattern', 'range', 'required', 'duplicate_key', 'schema_unknown', 'too_large'] as const;

export type StatsErrorCode = (typeof STATS_ERROR_CODES)[number];

/** One reason a report is refused: a JSON pointer and a code from a closed list. */
export interface StatsFieldError {
  path: string;
  code: StatsErrorCode;
}

/** The outcome of the checks: the report (`ok`), or the answer Ever Platform would give. */
export interface StatsCheck {
  ok: boolean;
  report?: Record<string, unknown>;
  status?: 413 | 422;
  errors?: StatsFieldError[];
}

/** The deepest nesting a report may have. */
export const MAX_STATS_DEPTH = 16;

const SECTIONS = ['counts', 'features', 'aggregates'];

/** A copy of the vendored schema (never shared, so nothing can change the vendored object). */
export function loadStatsSchema(): Schema {
  return JSON.parse(JSON.stringify(VENDORED_SCHEMA));
}

const isObject = (value: unknown): value is { [key: string]: any } => value !== null && typeof value === 'object' && !Array.isArray(value);

const escapeSegment = (segment: string) => segment.replace(/~/g, '~0').replace(/\//g, '~1');

const child = (path: string, key: string | number) => `${path}/${escapeSegment(String(key))}`;

class Offence extends Error {
  constructor(
    readonly path: string,
    readonly code: StatsErrorCode,
  ) {
    super(code);
  }
}

const DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
/** The magnitudes of the smallest signed and the largest unsigned 64-bit integers. */
const I64_MIN_MAGNITUDE = '9223372036854775808';
const U64_MAX = '18446744073709551615';

/** Whether the digits of a JSON integer (no sign, no leading zero) are above `limit`. */
function above(digits: string, limit: string): boolean {
  return digits.length > limit.length || (digits.length === limit.length && digits > limit);
}

function decodeUtf8(bytes: Uint8Array): string {
  try {
    return DECODER.decode(bytes);
  } catch {
    throw new Offence('', 'type');
  }
}
const SIMPLE_ESCAPES: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

/** Parses `bytes` strictly; throws an {@link Offence} at the first problem. */
export function strictParse(bytes: Uint8Array): Json {
  const text = decodeUtf8(bytes);
  let at = 0;
  const ws = () => {
    while (at < text.length && ' \t\n\r'.includes(text[at])) at += 1;
  };
  const fail = (path: string): never => {
    throw new Offence(path, 'type');
  };
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';

  const readString = (path: string): string => {
    at += 1;
    let out = '';
    for (;;) {
      if (at >= text.length) fail(path);
      const c = text[at];
      if (c === '"') {
        at += 1;
        return out;
      }
      if (c.charCodeAt(0) < 0x20) fail(path);
      if (c !== '\\') {
        out += c;
        at += 1;
        continue;
      }
      const escaped = text[at + 1];
      at += 2;
      if (escaped in SIMPLE_ESCAPES) {
        out += SIMPLE_ESCAPES[escaped];
      } else if (escaped === 'u') {
        const hex = text.slice(at, at + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail(path);
        out += String.fromCharCode(parseInt(hex, 16));
        at += 4;
      } else {
        fail(path);
      }
    }
  };

  const readNumber = (path: string): number => {
    const start = at;
    if (text[at] === '-') at += 1;
    if (text[at] === '0') at += 1;
    else if (isDigit(text[at])) while (isDigit(text[at])) at += 1;
    else fail(path);
    if (text[at] === '.' || text[at] === 'e' || text[at] === 'E') {
      throw new Offence(path, 'type');
    }
    const digits = text.slice(start, at);
    const negative = digits.startsWith('-');
    if (above(negative ? digits.slice(1) : digits, negative ? I64_MIN_MAGNITUDE : U64_MAX)) throw new Offence(path, 'range');
    return Number(digits);
  };

  const literal = (word: string, result: Json, path: string): Json => {
    if (!text.startsWith(word, at)) fail(path);
    at += word.length;
    return result;
  };

  function readObject(path: string, depth: number): Json {
    at += 1;
    const out: { [key: string]: Json } = Object.create(null);
    ws();
    if (text[at] === '}') {
      at += 1;
      return out;
    }
    for (;;) {
      ws();
      if (text[at] !== '"') fail(path);
      const key = readString(path);
      const here = child(path, key);
      ws();
      if (text[at] !== ':') fail(path);
      at += 1;
      const item = readValue(here, depth + 1);
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new Offence(here, 'duplicate_key');
      }
      out[key] = item;
      ws();
      if (text[at] === ',') at += 1;
      else if (text[at] === '}') {
        at += 1;
        return out;
      } else fail(path);
    }
  }

  function readArray(path: string, depth: number): Json {
    at += 1;
    const items: Json[] = [];
    ws();
    if (text[at] === ']') {
      at += 1;
      return items;
    }
    for (;;) {
      items.push(readValue(child(path, items.length), depth + 1));
      ws();
      if (text[at] === ',') at += 1;
      else if (text[at] === ']') {
        at += 1;
        return items;
      } else fail(path);
    }
  }

  function readValue(path: string, depth: number): Json {
    if (depth > MAX_STATS_DEPTH) fail(path);
    ws();
    const c = text[at];
    if (c === '{') return readObject(path, depth);
    if (c === '[') return readArray(path, depth);
    if (c === '"') return readString(path);
    if (c === 't') return literal('true', true, path);
    if (c === 'f') return literal('false', false, path);
    if (c === 'n') return literal('null', null, path);
    if (c === '-' || isDigit(c)) return readNumber(path);
    return fail(path);
  }

  const doc = readValue('', 0);
  ws();
  if (at !== text.length) fail('');
  return doc;
}

/** Whether `YYYY-MM-DD` names a day that exists. */
export function isCalendarDate(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days;
}

function codeOf(error: ErrorObject): StatsErrorCode {
  switch (error.keyword) {
    case 'additionalProperties':
    case 'unevaluatedProperties':
      return 'unknown_field';
    case 'required':
      return 'required';
    case 'type':
      return 'type';
    case 'enum':
    case 'const':
    case 'pattern':
    case 'maxLength':
    case 'minLength':
    case 'propertyNames':
      return 'pattern';
    case 'minimum':
    case 'maximum':
    case 'exclusiveMinimum':
    case 'exclusiveMaximum':
    case 'minItems':
    case 'maxItems':
    case 'uniqueItems':
    case 'minProperties':
    case 'maxProperties':
      return 'range';
    default:
      return 'type';
  }
}

function pathOf(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  if (error.keyword === 'additionalProperties') {
    return child(error.instancePath, String(params.additionalProperty));
  }
  if (error.keyword === 'required') {
    return child(error.instancePath, String(params.missingProperty));
  }
  const propertyName = (error as { propertyName?: string }).propertyName ?? params.propertyName;
  if (typeof propertyName === 'string') {
    return child(error.instancePath, propertyName);
  }
  return error.instancePath;
}

/** Every property name the schema declares, anywhere (its vocabulary). */
function vocabulary(schema: unknown, words = new Set<string>()): Set<string> {
  if (Array.isArray(schema)) {
    for (const item of schema) vocabulary(item, words);
  } else if (isObject(schema)) {
    if (isObject(schema.properties)) {
      for (const name of Object.keys(schema.properties)) words.add(name);
    }
    for (const item of Object.values(schema)) vocabulary(item, words);
  }
  return words;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortErrors(errors: StatsFieldError[]): StatsFieldError[] {
  const seen = new Set<string>();
  return errors
    .filter(error => {
      const key = `${error.path}\u0000${error.code}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => compareText(a.path, b.path) || compareText(a.code, b.code))
    .slice(0, 20);
}

/** Validates statistics reports against the vendored `ever.stats.v1` schema. */
export class StatsValidator {
  private readonly envelope: ValidateFunction;
  private readonly sections = new Map<string, ValidateFunction>();
  private readonly products: string[];
  private readonly words: Set<string>;

  constructor(private readonly schema: Schema = loadStatsSchema()) {
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    this.products = [...(schema.properties?.product?.enum ?? [])];
    const defs: Schema = schema.$defs ?? {};
    // The product containers of `$defs` hold the closed lists (`counts`, `features`, `aggregates`); they are not
    // schemas themselves, so each list is compiled on its own with the shared definitions.
    const shared: Schema = {};
    for (const [name, definition] of Object.entries(defs)) {
      if (!this.products.includes(name)) shared[name] = definition;
    }
    const rest: Schema = {};
    for (const [key, item] of Object.entries(schema)) {
      if (key !== 'oneOf' && key !== '$defs') rest[key] = item;
    }
    this.envelope = ajv.compile({ ...rest, $defs: shared });
    for (const product of this.products) {
      for (const section of SECTIONS) {
        const list = defs[product]?.[section];
        if (isObject(list)) {
          this.sections.set(`${product}/${section}`, ajv.compile({ $schema: schema.$schema, $defs: shared, ...list }));
        }
      }
    }
    this.words = vocabulary(schema);
  }

  /** Runs every check on `bytes`. With `product`, a report of another product is refused. */
  checkBytes(bytes: Uint8Array, product?: string): StatsCheck {
    if (bytes.length > MAX_STATS_REPORT_BYTES) {
      return { ok: false, status: 413, errors: [{ path: '', code: 'too_large' }] };
    }
    let document: Json;
    try {
      document = strictParse(bytes);
    } catch (error) {
      if (!(error instanceof Offence)) throw error;
      return { ok: false, status: 422, errors: [{ path: error.path, code: error.code }] };
    }
    const errors = this.schemaErrors(document);
    if (!errors.length) {
      errors.push(...this.walkStrings(document));
    }
    const report = document as Record<string, unknown>;
    if (!errors.length && !isCalendarDate(String(report.sent_at))) {
      errors.push({ path: '/sent_at', code: 'range' });
    }
    if (!errors.length && product !== undefined && report.product !== product) {
      errors.push({ path: '/product', code: 'pattern' });
    }
    if (errors.length) {
      return { ok: false, status: 422, errors: sortErrors(errors) };
    }
    return { ok: true, report: JSON.parse(JSON.stringify(document)) };
  }

  /** The schema errors of a parsed document (both passes). */
  schemaErrors(document: unknown): StatsFieldError[] {
    const errors: StatsFieldError[] = [];
    const collect = (validate: ValidateFunction, input: unknown, prefix: string) => {
      if (validate(input)) return;
      for (const error of validate.errors ?? []) {
        const path = `${prefix}${pathOf(error)}`;
        let code = codeOf(error);
        if (path === '/schema' && code !== 'required') code = 'schema_unknown';
        errors.push({ path, code });
      }
    };
    collect(this.envelope, document, '');
    const product = isObject(document) ? document.product : undefined;
    if (typeof product === 'string' && this.products.includes(product)) {
      for (const section of SECTIONS) {
        const validate = this.sections.get(`${product}/${section}`);
        const input = (document as Record<string, unknown>)[section];
        if (validate && isObject(input)) collect(validate, input, `/${section}`);
      }
    }
    return sortErrors(errors);
  }

  /**
   * Every string value and map key must sit where the schema declares one and be bound there. Defence in depth behind
   * the schema pass: a schema that lost a constraint still cannot let free text through.
   */
  walkStrings(document: unknown): StatsFieldError[] {
    const errors: StatsFieldError[] = [];
    const product = isObject(document) ? document.product : undefined;
    const defs = this.schema.$defs ?? {};
    const sectionSchema = (section: string): Schema | undefined =>
      typeof product === 'string' && this.products.includes(product) ? defs[product]?.[section] : undefined;

    const resolve = (node: Schema | undefined): Schema | undefined => {
      let current = node;
      for (let i = 0; i < 8 && current && typeof current.$ref === 'string'; i += 1) {
        const parts: string[] = current.$ref.replace(/^#\//, '').split('/');
        current = parts.reduce<any>((acc, part) => (acc ? acc[part] : undefined), this.schema);
      }
      return current;
    };

    const bound = (node: Schema | undefined, text: string): boolean => {
      if (!node) return false;
      if ('const' in node) return node.const === text;
      if (Array.isArray(node.enum)) return node.enum.includes(text);
      if (typeof node.pattern !== 'string' || typeof node.maxLength !== 'number') return false;
      if (node.maxLength > 64 || Array.from(text).length > node.maxLength) return false;
      return new RegExp(node.pattern, 'u').test(text);
    };

    const visit = (node: Schema | undefined, input: unknown, path: string) => {
      const resolved = resolve(node);
      if (typeof input === 'string') {
        if (!bound(resolved, input)) errors.push({ path, code: 'pattern' });
        return;
      }
      if (Array.isArray(input)) {
        input.forEach((item, i) => visit(resolved?.items, item, child(path, i)));
        return;
      }
      if (!isObject(input)) return;
      for (const [key, item] of Object.entries(input)) {
        const here = child(path, key);
        let next: Schema | undefined;
        if (path === '' && SECTIONS.includes(key)) {
          next = sectionSchema(key);
        } else if (isObject(resolved?.properties) && key in resolved.properties) {
          next = resolved.properties[key];
        } else if (isObject(resolved?.additionalProperties)) {
          if (!bound(resolve(resolved.propertyNames), key)) {
            errors.push({ path: here, code: 'pattern' });
            continue;
          }
          next = resolved.additionalProperties;
        } else {
          errors.push({ path: here, code: 'unknown_field' });
          continue;
        }
        visit(next, item, here);
      }
    };

    visit(this.schema, document, '');
    return sortErrors(errors);
  }

  /**
   * A field path fit for a log line or a stored report row: a segment stays when the schema names it, or it is a
   * currency code or an array index; any other segment becomes `*`.
   */
  redactPath(path: string): string {
    if (path === '') return '';
    return path
      .split('/')
      .slice(1)
      .map(raw => {
        const segment = raw.replace(/~1/g, '/').replace(/~0/g, '~');
        return /^[A-Z]{3}$/.test(segment) || /^\d{1,2}$/.test(segment) || this.words.has(segment) ? raw : '*';
      })
      .reduce((out, segment) => `${out}/${segment}`, '');
  }
}
