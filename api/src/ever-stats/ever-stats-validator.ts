/**
 * The checks a statistics report passes before it is signed, run on the exact bytes that would be sent, in the order
 * the receiving side runs them, so a report this module lets through is one Ever Platform accepts:
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
import * as vendoredSchema from './schema/ever.stats.v1.json';
import { MAX_STATS_REPORT_BYTES } from './ever-stats.constants';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Schema = { [key: string]: any };

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

/** A fresh copy of the vendored schema. */
export function loadStatsSchema(): Schema {
  const { default: _ignored, ...schema } = vendoredSchema as Schema;
  return JSON.parse(JSON.stringify(schema));
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
const I64_MIN_ABS = '9223372036854775808';
const U64_MAX = '18446744073709551615';

/** Whether a JSON integer (digits, optionally negative) falls outside the 64-bit range the receiving side reads. */
function outOfRange(digits: string): boolean {
  const negative = digits.startsWith('-');
  const magnitude = (negative ? digits.slice(1) : digits).replace(/^0+(?=\d)/, '');
  const limit = negative ? I64_MIN_ABS : U64_MAX;
  return magnitude.length > limit.length || (magnitude.length === limit.length && magnitude > limit);
}

/** Parses `bytes` strictly; throws an {@link Offence} at the first problem. */
export function strictParse(bytes: Uint8Array): Json {
  let text: string;
  try {
    text = DECODER.decode(bytes);
  } catch {
    throw new Offence('', 'type');
  }
  let at = 0;
  const ws = () => {
    while (at < text.length && ' \t\n\r'.includes(text[at])) at += 1;
  };
  const fail = (path: string): never => {
    throw new Offence(path, 'type');
  };
  const isDigit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  const simple: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

  const string = (path: string): string => {
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
      const e = text[at + 1];
      at += 2;
      if (e in simple) {
        out += simple[e];
      } else if (e === 'u') {
        const hex = text.slice(at, at + 4);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail(path);
        out += String.fromCharCode(parseInt(hex, 16));
        at += 4;
      } else {
        fail(path);
      }
    }
  };

  const number = (path: string): number => {
    const start = at;
    if (text[at] === '-') at += 1;
    if (text[at] === '0') at += 1;
    else if (isDigit(text[at])) while (isDigit(text[at])) at += 1;
    else fail(path);
    if (text[at] === '.' || text[at] === 'e' || text[at] === 'E') {
      throw new Offence(path, 'type');
    }
    const digits = text.slice(start, at);
    if (outOfRange(digits)) throw new Offence(path, 'range');
    return Number(digits);
  };

  const literal = (word: string, result: Json, path: string): Json => {
    if (!text.startsWith(word, at)) fail(path);
    at += word.length;
    return result;
  };

  const value = (path: string, depth: number): Json => {
    if (depth > MAX_STATS_DEPTH) fail(path);
    ws();
    const c = text[at];
    if (c === '{') return object(path, depth);
    if (c === '[') return array(path, depth);
    if (c === '"') return string(path);
    if (c === 't') return literal('true', true, path);
    if (c === 'f') return literal('false', false, path);
    if (c === 'n') return literal('null', null, path);
    if (c === '-' || isDigit(c)) return number(path);
    return fail(path);
  };

  const object = (path: string, depth: number): Json => {
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
      const key = string(path);
      const here = child(path, key);
      ws();
      if (text[at] !== ':') fail(path);
      at += 1;
      const v = value(here, depth + 1);
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        throw new Offence(here, 'duplicate_key');
      }
      out[key] = v;
      ws();
      if (text[at] === ',') at += 1;
      else if (text[at] === '}') {
        at += 1;
        return out;
      } else fail(path);
    }
  };

  const array = (path: string, depth: number): Json => {
    at += 1;
    const items: Json[] = [];
    ws();
    if (text[at] === ']') {
      at += 1;
      return items;
    }
    for (;;) {
      items.push(value(child(path, items.length), depth + 1));
      ws();
      if (text[at] === ',') at += 1;
      else if (text[at] === ']') {
        at += 1;
        return items;
      } else fail(path);
    }
  };

  const doc = value('', 0);
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

const KEYWORD_CODES: Record<string, StatsErrorCode> = {
  additionalProperties: 'unknown_field',
  unevaluatedProperties: 'unknown_field',
  required: 'required',
  type: 'type',
  enum: 'pattern',
  const: 'pattern',
  pattern: 'pattern',
  maxLength: 'pattern',
  minLength: 'pattern',
  propertyNames: 'pattern',
  minimum: 'range',
  maximum: 'range',
  exclusiveMinimum: 'range',
  exclusiveMaximum: 'range',
  minItems: 'range',
  maxItems: 'range',
  uniqueItems: 'range',
  minProperties: 'range',
  maxProperties: 'range',
};

function codeOf(error: ErrorObject): StatsErrorCode {
  return KEYWORD_CODES[error.keyword] ?? 'type';
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

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

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

const SECTIONS = ['counts', 'features', 'aggregates'];

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
    const shared = Object.fromEntries(Object.entries(defs).filter(([name]) => !this.products.includes(name)));
    const rest = Object.fromEntries(Object.entries(schema).filter(([key]) => key !== 'oneOf' && key !== '$defs'));
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
    const collect = (validate: ValidateFunction, value: unknown, prefix: string) => {
      if (validate(value)) return;
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
        const value = (document as Record<string, unknown>)[section];
        if (validate && isObject(value)) collect(validate, value, `/${section}`);
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
        const parts = current.$ref.replace(/^#\//, '').split('/');
        current = parts.reduce<any>((acc, part) => (acc ? acc[part] : undefined), this.schema);
      }
      return current;
    };

    const bound = (node: Schema | undefined, value: string): boolean => {
      if (!node) return false;
      if ('const' in node) return node.const === value;
      if (Array.isArray(node.enum)) return node.enum.includes(value);
      if (typeof node.pattern !== 'string' || typeof node.maxLength !== 'number') return false;
      if (node.maxLength > 64 || [...value].length > node.maxLength) return false;
      return new RegExp(node.pattern, 'u').test(value);
    };

    const visitObject = (schema: Schema | undefined, value: Record<string, unknown>, path: string) => {
      for (const [key, item] of Object.entries(value)) {
        const here = child(path, key);
        let next: Schema | undefined;
        if (path === '' && SECTIONS.includes(key)) {
          next = sectionSchema(key);
        } else if (isObject(schema?.properties) && key in schema.properties) {
          next = schema.properties[key];
        } else if (isObject(schema?.additionalProperties)) {
          if (!bound(resolve(schema.propertyNames), key)) {
            errors.push({ path: here, code: 'pattern' });
            continue;
          }
          next = schema.additionalProperties;
        } else {
          errors.push({ path: here, code: 'unknown_field' });
          continue;
        }
        visit(next, item, here);
      }
    };

    const visit = (node: Schema | undefined, value: unknown, path: string) => {
      const schema = resolve(node);
      if (typeof value === 'string') {
        if (!bound(schema, value)) errors.push({ path, code: 'pattern' });
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, i) => visit(schema?.items, item, child(path, i)));
        return;
      }
      if (isObject(value)) {
        visitObject(schema, value, path);
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
