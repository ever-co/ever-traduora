/**
 * Environment parsing of the optional Ever Platform modules (`ever-instance`, `ever-stats`).
 *
 * Kept free of Nest imports and of any network code: `config.ts` calls {@link readEverPlatformConfig} when it is loaded,
 * before any provider exists.
 *
 * A warning names the variable only. A value is repeated only when it is a short plain word (letters, digits, `_` or
 * `-`): anything an operator typed could otherwise end up in a log line.
 */

export type Env = Record<string, string | undefined>;
export type Warn = (message: string) => void;

/** The values `TR_EVER_INSTALL_SOURCE` accepts. Unset means `self-hosted`; nothing infers it. */
export type InstallSource = 'cloud' | 'self-hosted' | 'ever.sh' | 'works_app' | 'desktop' | `partner:${string}`;

export const INSTALL_SOURCES: ReadonlyArray<string> = Object.freeze(['cloud', 'self-hosted', 'ever.sh', 'works_app', 'desktop']);

export const DEFAULT_INSTALL_SOURCE: InstallSource = 'self-hosted';

/** The default Ever Platform API origin. */
export const DEFAULT_EVER_PLATFORM_API_URL = 'https://api.ever.co';

/** A day: the interval between two statistics reports. */
export const DEFAULT_STATS_SEND_INTERVAL_S = 86400;

/** The shortest interval accepted for a public destination; shorter ones only for a local test destination. */
export const MIN_PUBLIC_STATS_SEND_INTERVAL_S = 3600;

/** The admin e-mail Traduora uses when `TR_ADMIN_EMAIL` is unset. */
export const FALLBACK_ADMIN_EMAIL = 'local.admin@ever.co';

const PARTNER = /^partner:[a-z0-9-]{2,32}$/;

/** How the Ever Platform connection reads its event feed: a long poll, or one read every 15 minutes. */
export type ConnectFeedMode = 'longpoll' | 'interval';

/** The settings of the optional Ever Platform modules, read once at boot. */
export interface EverPlatformConfig {
  /** `TR_EVER_PLATFORM_API_URL`, or `null` when it is set to an address that cannot be used. */
  apiUrl: string | null;
  /** Declared by `TR_EVER_INSTALL_SOURCE`, never inferred. */
  installSource: InstallSource;
  /**
   * Whether the anonymous usage statistics (and the instance identity they need) are loaded: on unless
   * `TR_EVER_STATS_ENABLED` is exactly `'false'`. Unset or malformed keeps them on (a malformed value is named once in the
   * boot log).
   */
  statsEnabled: boolean;
  /** Where reports go (`TR_EVER_STATS_API_URL`, else `TR_EVER_PLATFORM_API_URL`), or `null`: then nothing is sent. */
  statsApiUrl: string | null;
  /** ISO 3166-1 alpha-2 country declared by the operator, or `ZZ` (undeclared). */
  statsCountry: string;
  /** Seconds between two reports: a day unless a test overrides it. */
  statsSendIntervalS: number;
  /** The normalized e-mails of the users who operate this installation. */
  adminEmails: ReadonlyArray<string>;
  /** Whether the Ever Platform connection module is loaded: only `TR_EVER_CONNECT_ENABLED=true` loads it. */
  connectEnabled: boolean;
  /** A connect code (`EVC-…`) to redeem once at boot, or `null` (`TR_EVER_CONNECT_CODE`). */
  connectCode: string | null;
  /** Integration keys the operator denies on this installation, whatever app.ever.co says (`TR_EVER_CONNECT_INTEGRATIONS_DENY`). */
  connectIntegrationsDeny: ReadonlyArray<string>;
  /** `TR_EVER_CONNECT_FEED_MODE`: `longpoll` (default) or `interval`. */
  connectFeedMode: ConnectFeedMode;
  /**
   * For a local test platform only (the SDK ignores them for any other address): the issuer its documents name
   * (`TR_EVER_PLATFORM_ISSUER`) and a file of extra root keys (`TR_EVER_PLATFORM_ROOT_KEYS_FILE`).
   */
  platformIssuer: string | null;
  platformRootKeysFile: string | null;
}

const consoleWarn: Warn = message => console.warn(`[EverPlatform] ${message}`);

/**
 * `value`, quoted, when it is a short plain word (spaces around it shown, since they are what makes `"false "` not
 * `false`); otherwise a neutral word.
 */
function describe(value: string): string {
  return value.length <= 24 && /^\s*[A-Za-z0-9_-]{1,16}\s*$/.test(value) ? JSON.stringify(value) : 'an unrecognised value';
}

/**
 * A strict boolean switch: only the exact strings `'true'` and `'false'` change anything. Unset or empty keeps
 * `fallback`; any other value (`TRUE`, `1`, `on`, ...) keeps `fallback` and is reported through `warn`.
 */
export function readStrictBool(name: string, fallback: boolean, env: Env = process.env, warn: Warn = consoleWarn): boolean {
  const raw = env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  warn(`${name} is ${describe(raw)}, which is neither "true" nor "false"; the default (${fallback ? 'on' : 'off'}) applies.`);
  return fallback;
}

/** An e-mail as Traduora compares it: trimmed and lower-cased. */
export function normalizeEmail(email: string | undefined | null): string {
  return (email || '').trim().toLowerCase();
}

/** A comma-separated list of e-mails, normalized, without empty or duplicate entries. */
export function parseEmailList(raw: string | undefined): string[] {
  const emails = (raw || '')
    .split(',')
    .map(normalizeEmail)
    .filter(email => email.length > 0 && email.length <= 254 && email.includes('@'));
  return Array.from(new Set(emails));
}

/**
 * How this installation was deployed, as its operator declares it in `TR_EVER_INSTALL_SOURCE`. It is never inferred from
 * a host name or any other signal. Unset gives `self-hosted`; a value outside the closed list gives `self-hosted` and a
 * warning.
 */
export function readInstallSource(env: Env = process.env, warn: Warn = consoleWarn): InstallSource {
  const raw = env.TR_EVER_INSTALL_SOURCE;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_INSTALL_SOURCE;
  }
  const value = raw.trim();
  if (INSTALL_SOURCES.includes(value) || PARTNER.test(value)) {
    return value as InstallSource;
  }
  warn('TR_EVER_INSTALL_SOURCE is not one of cloud, self-hosted, ever.sh, works_app, desktop or partner:<slug>; using self-hosted.');
  return DEFAULT_INSTALL_SOURCE;
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2[0-9]|3[01])\./];

/** Single-label names that are never a local service (`metadata` is a cloud metadata service). */
const NOT_LOCAL_NAMES = new Set(['metadata']);

/** A host plain `http` may reach: loopback, an RFC 1918 address, or a single-label name (a container or compose service). */
export function isLocalHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return true;
  }
  // A private range only for a complete IPv4 address: `10.example.com` is a public name
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    return PRIVATE_V4.some(re => re.test(host));
  }
  return /^[a-z\d-]+$/.test(host) && !/^\d+$/.test(host) && !NOT_LOCAL_NAMES.has(host);
}

/**
 * A base URL read from the first of `names` that is set, else `fallback`. A set value that cannot be used (not a URL,
 * plain `http` to a public host, a credential, a query or a fragment) gives `null` and a warning: the operator's choice
 * is never replaced by another address.
 */
export function readApiUrl(names: string[], fallback: string, env: Env = process.env, warn: Warn = consoleWarn): string | null {
  const name = names.find(candidate => (env[candidate] || '').trim() !== '');
  if (!name) {
    return fallback;
  }
  const configured = env[name].trim();
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    warn(`${name} is not a URL; nothing is sent until it is corrected.`);
    return null;
  }
  const protocolOk = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname));
  if (!protocolOk || url.username || url.password || url.search || url.hash) {
    warn(
      `${name} must be https (plain http only for localhost, a private address or a container name) and carry no credential, ` +
        'query or fragment; nothing is sent until it is corrected.',
    );
    return null;
  }
  let path = url.pathname;
  while (path.endsWith('/')) {
    path = path.slice(0, -1);
  }
  return `${url.origin}${path}`;
}

/** `TR_EVER_STATS_COUNTRY`, upper-cased, when it is two letters; otherwise `ZZ` (undeclared). */
export function readCountry(env: Env = process.env, warn: Warn = consoleWarn): string {
  const raw = env.TR_EVER_STATS_COUNTRY;
  if (raw === undefined || raw.trim() === '') {
    return 'ZZ';
  }
  const value = raw.trim().toUpperCase();
  if (/^[A-Z]{2}$/.test(value)) {
    return value;
  }
  warn('TR_EVER_STATS_COUNTRY is not a two-letter country code; using ZZ (undeclared).');
  return 'ZZ';
}

/**
 * `TR_EVER_STATS_SEND_INTERVAL_S`: whole seconds from 1 to a week. Below an hour only for a local destination (tests) or
 * under `NODE_ENV=test`; anything else gives a day and a warning.
 */
export function readSendInterval(env: Env, localDestination: boolean, warn: Warn = consoleWarn): number {
  const raw = env.TR_EVER_STATS_SEND_INTERVAL_S;
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_STATS_SEND_INTERVAL_S;
  }
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 604800) {
    warn(`TR_EVER_STATS_SEND_INTERVAL_S is not a whole number of seconds between 1 and 604800; using ${DEFAULT_STATS_SEND_INTERVAL_S}.`);
    return DEFAULT_STATS_SEND_INTERVAL_S;
  }
  if (value < MIN_PUBLIC_STATS_SEND_INTERVAL_S && !localDestination && env.NODE_ENV !== 'test') {
    warn(
      `TR_EVER_STATS_SEND_INTERVAL_S below ${MIN_PUBLIC_STATS_SEND_INTERVAL_S} is accepted only for a local TR_EVER_STATS_API_URL; ` +
        `using ${DEFAULT_STATS_SEND_INTERVAL_S}.`,
    );
    return DEFAULT_STATS_SEND_INTERVAL_S;
  }
  return value;
}

/** `TR_EVER_CONNECT_FEED_MODE`: `longpoll` unless it is exactly `interval`; anything else is reported. */
export function readFeedMode(env: Env = process.env, warn: Warn = consoleWarn): ConnectFeedMode {
  const raw = (env.TR_EVER_CONNECT_FEED_MODE || '').trim();
  if (raw === '' || raw === 'longpoll') {
    return 'longpoll';
  }
  if (raw === 'interval') {
    return 'interval';
  }
  warn('TR_EVER_CONNECT_FEED_MODE is neither "longpoll" nor "interval"; using longpoll.');
  return 'longpoll';
}

/** A comma-separated list of integration keys, lower-cased, without empty or duplicate entries. */
export function parseKeyList(raw: string | undefined): string[] {
  const keys = (raw || '')
    .split(',')
    .map(key => key.trim().toLowerCase())
    .filter(key => /^[a-z][a-z0-9_]{1,63}$/.test(key));
  return Array.from(new Set(keys));
}

/** Reads every Ever Platform setting once. A malformed value falls back to its default with a warning. */
export function readEverPlatformConfig(env: Env = process.env, warn: Warn = consoleWarn): EverPlatformConfig {
  // Anonymous statistics are on unless switched off with exactly 'false'; the connection is off unless exactly 'true'
  const statsEnabled = readStrictBool('TR_EVER_STATS_ENABLED', true, env, warn);
  const connectEnabled = readStrictBool('TR_EVER_CONNECT_ENABLED', false, env, warn);
  // The other settings are only reported when a module that reads them is loaded
  const statsWarn: Warn = statsEnabled ? warn : () => undefined;
  const connectWarn: Warn = connectEnabled ? warn : () => undefined;
  const anyWarn: Warn = statsEnabled || connectEnabled ? warn : () => undefined;
  const apiUrl = readApiUrl(['TR_EVER_PLATFORM_API_URL'], DEFAULT_EVER_PLATFORM_API_URL, env, anyWarn);
  const statsApiUrl = readApiUrl(['TR_EVER_STATS_API_URL', 'TR_EVER_PLATFORM_API_URL'], DEFAULT_EVER_PLATFORM_API_URL, env, statsWarn);
  let localDestination = false;
  try {
    localDestination = statsApiUrl !== null && isLocalHost(new URL(statsApiUrl).hostname);
  } catch {
    localDestination = false;
  }
  const adminEmails = parseEmailList(env.TR_EVER_ADMIN_EMAILS);
  return {
    apiUrl,
    installSource: readInstallSource(env, anyWarn),
    statsEnabled,
    statsApiUrl,
    statsCountry: readCountry(env, statsWarn),
    statsSendIntervalS: readSendInterval(env, localDestination, statsWarn),
    adminEmails: adminEmails.length ? adminEmails : [normalizeEmail(env.TR_ADMIN_EMAIL) || FALLBACK_ADMIN_EMAIL],
    connectEnabled,
    connectCode: (env.TR_EVER_CONNECT_CODE || '').trim() || null,
    connectIntegrationsDeny: parseKeyList(env.TR_EVER_CONNECT_INTEGRATIONS_DENY),
    connectFeedMode: readFeedMode(env, connectWarn),
    platformIssuer: (env.TR_EVER_PLATFORM_ISSUER || '').trim() || null,
    platformRootKeysFile: (env.TR_EVER_PLATFORM_ROOT_KEYS_FILE || '').trim() || null,
  };
}
