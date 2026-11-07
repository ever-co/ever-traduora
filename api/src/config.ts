import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DefaultNamingStrategy } from 'typeorm';
import { createHash, randomBytes } from 'crypto';
import { join } from 'path';
import * as process from 'process';
import { SnakeNamingStrategy } from './utils/snake-naming-strategy';

const env = process.env;
const getBoolOrDefault = (value: string, defaultValue: boolean) => (value ? value === 'true' : defaultValue);

const getNumberOrDefault = (value: string, defaultValue: number) => {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
};

// SHA-256 of secrets anyone can sign tokens with: the former built-in default ('secret'), the examples once shipped in
// .env.sample ('supersecretkey') and the docs ('mysupersecret'), and the TR_SECRET of the old k8s preview manifest
const PUBLISHED_SECRET_HASHES = new Set([
  '2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b',
  'e706386a58190ee13247ffc85c07f5fee617aed1e339cd935e64bab32bfe8fc8',
  'fc09b602d09745f0dec54c80796461f5761dec1f54c920b15eef496fc7836491',
  '73d7a744ab6f3f3785873fc271c594003995f8697bc003bc6347be75383d9ccf',
]);

const isPublishedSecret = (secret: string) => PUBLISHED_SECRET_HASHES.has(createHash('sha256').update(secret).digest('hex'));

const getListOrDefault = (value: string | undefined): string[] =>
  (value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);

/**
 * A strict switch: only the exact strings 'true' and 'false' change anything. Unset or empty keeps the default, and so
 * does any other value ('FALSE', '0', 'off'...), which is reported through `onMalformed`. Unlike `getBoolOrDefault`, a
 * typo never turns a switch that is on by default off.
 */
export const getStrictBoolOrDefault = (value: string | undefined, defaultValue: boolean, onMalformed?: (value: string) => void): boolean => {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (value !== undefined && value !== '' && onMalformed) {
    onMalformed(value);
  }
  return defaultValue;
};

/** An e-mail address as the Ever Platform settings compare it: trimmed and lower-cased. */
export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** How this installation was set up, as its operator declares it in TR_EVER_INSTALL_SOURCE. Never inferred. */
export type EverInstallSource = 'cloud' | 'self-hosted' | 'ever.sh' | 'works_app' | 'desktop' | `partner:${string}`;

const EVER_INSTALL_SOURCE = /^(cloud|self-hosted|ever\.sh|works_app|desktop|partner:[a-z0-9-]{2,32})$/;

/** The default and the shortest public interval between two statistics reports, in seconds. */
export const EVER_STATS_DEFAULT_INTERVAL_S = 86400;
export const EVER_STATS_MIN_PUBLIC_INTERVAL_S = 3600;
const EVER_STATS_MAX_INTERVAL_S = 604800;

/** The settings of the optional Ever Platform features (anonymous usage statistics), read once at startup. */
export interface EverPlatformConfig {
  /** TR_EVER_PLATFORM_API_URL: the Ever Platform API. */
  apiUrl: string;
  /** TR_EVER_INSTALL_SOURCE, `self-hosted` when unset or not one of the known values. */
  installSource: EverInstallSource;
  /** Whether the statistics are loaded: on unless TR_EVER_STATS_ENABLED is exactly 'false'. */
  statsEnabled: boolean;
  /**
   * Where statistics reports go (TR_EVER_STATS_API_URL, then TR_EVER_PLATFORM_API_URL), or null when the configured
   * address cannot be used: then no report is sent. It is never replaced by another address.
   */
  statsApiUrl: string | null;
  /** TR_EVER_STATS_COUNTRY upper-cased (two letters), else `ZZ` (not declared). */
  statsCountry: string;
  /** Seconds between two reports: a day, unless a test with a local destination shortens it. */
  statsSendIntervalS: number;
  /** The operators of this installation (TR_EVER_ADMIN_EMAILS, default TR_ADMIN_EMAIL), normalized. */
  adminEmails: string[];
  /** Whether TR_SECRET is set: the statistics key is stored encrypted under a key derived from it. */
  secretConfigured: boolean;
}

/** A configured value in a log line only when it is short and plain: anything else an operator typed stays out of logs. */
const describeEnvValue = (value: string): string => (/^[A-Za-z0-9_-]{1,16}$/.test(value) ? `"${value}"` : 'an unrecognised value');

const PRIVATE_IPV4 = [/^10\./, /^127\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

/**
 * A host plain http may reach: this machine (loopback), an address of a private range, or a single-label name such as a
 * compose service (`mock-platform`). `metadata` (a cloud metadata service) is never one.
 */
export const isLocalHost = (hostname: string): boolean => {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1') {
    return true;
  }
  if (PRIVATE_IPV4.some(range => range.test(host))) {
    return true;
  }
  return /^[a-z\d-]+$/.test(host) && !/^\d+$/.test(host) && host !== 'metadata';
};

/**
 * A base URL Ever Platform requests may use: https, or plain http to a local host only; no credential, query or
 * fragment. Answers the URL without a trailing slash, or null.
 */
export const usableEverApiUrl = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const protocolOk = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalHost(url.hostname));
  if (!protocolOk || url.username || url.password || url.search || url.hash) {
    return null;
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};

/**
 * Reads the Ever Platform settings. A malformed value falls back to its default with one warning that names the
 * variable (and the value only when it is short and plain); a malformed destination sends nothing.
 */
export const readEverPlatformConfig = (
  source: Record<string, string | undefined>,
  warn: (message: string) => void = message => console.warn(`[Ever Platform] ${message}`),
): EverPlatformConfig => {
  const value = (name: string) => (source[name] ?? '').trim();

  const statsEnabled = getStrictBoolOrDefault(source.TR_EVER_STATS_ENABLED, true, raw =>
    warn(`TR_EVER_STATS_ENABLED is ${describeEnvValue(raw)}, which is neither "true" nor "false"; the default (on) applies.`),
  );

  const apiUrl = value('TR_EVER_PLATFORM_API_URL') || 'https://api.ever.co';
  const statsUrlName = value('TR_EVER_STATS_API_URL') ? 'TR_EVER_STATS_API_URL' : 'TR_EVER_PLATFORM_API_URL';
  const statsApiUrl = usableEverApiUrl(value('TR_EVER_STATS_API_URL') || apiUrl);
  if (statsApiUrl === null) {
    warn(
      `ever_stats.url_insecure: ${statsUrlName} must be https (plain http only for localhost, a private address or a container name) ` +
        'and carry no credential, query or fragment; no statistics report is sent until it is corrected.',
    );
  }

  let installSource: EverInstallSource = 'self-hosted';
  if (value('TR_EVER_INSTALL_SOURCE')) {
    if (EVER_INSTALL_SOURCE.test(value('TR_EVER_INSTALL_SOURCE'))) {
      installSource = value('TR_EVER_INSTALL_SOURCE') as EverInstallSource;
    } else {
      warn('TR_EVER_INSTALL_SOURCE is not one of cloud, self-hosted, ever.sh, works_app, desktop or partner:<name>; using self-hosted.');
    }
  }

  let statsCountry = 'ZZ';
  if (value('TR_EVER_STATS_COUNTRY')) {
    const country = value('TR_EVER_STATS_COUNTRY').toUpperCase();
    if (/^[A-Z]{2}$/.test(country)) {
      statsCountry = country;
    } else {
      warn('TR_EVER_STATS_COUNTRY is not a two-letter country code; using ZZ (not declared).');
    }
  }

  let statsSendIntervalS = EVER_STATS_DEFAULT_INTERVAL_S;
  if (value('TR_EVER_STATS_SEND_INTERVAL_S')) {
    const seconds = Number(value('TR_EVER_STATS_SEND_INTERVAL_S'));
    const local = statsApiUrl !== null && isLocalHost(new URL(statsApiUrl).hostname);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > EVER_STATS_MAX_INTERVAL_S) {
      warn(`TR_EVER_STATS_SEND_INTERVAL_S is not a whole number of seconds from 1 to ${EVER_STATS_MAX_INTERVAL_S}; using a day.`);
    } else if (seconds < EVER_STATS_MIN_PUBLIC_INTERVAL_S && !local && source.NODE_ENV !== 'test') {
      warn(`TR_EVER_STATS_SEND_INTERVAL_S below ${EVER_STATS_MIN_PUBLIC_INTERVAL_S} is accepted only for a local TR_EVER_STATS_API_URL (tests); using a day.`);
    } else {
      statsSendIntervalS = seconds;
    }
  }

  const adminEmails = (value('TR_EVER_ADMIN_EMAILS') || value('TR_ADMIN_EMAIL') || 'local.admin@ever.co')
    .split(',')
    .map(normalizeEmail)
    .filter(Boolean);

  return {
    apiUrl,
    installSource,
    statsEnabled,
    statsApiUrl,
    statsCountry,
    statsSendIntervalS,
    adminEmails,
    secretConfigured: Boolean(source.TR_SECRET),
  };
};

/**
 * Scopes requested from the Ever ID (OpenID Connect) issuer. With an Ever Platform project id (Ever ID), the token also
 * names the account's organization and is issued for that project's audience. Without one (another OpenID Connect
 * issuer), only the standard scopes are requested, which every issuer accepts.
 */
export const everIdScope = (platformProjectId?: string): string => {
  const scopes = ['openid', 'profile', 'email'];
  const projectId = platformProjectId?.trim();
  if (projectId) {
    scopes.push('urn:zitadel:iam:user:resourceowner', `urn:zitadel:iam:org:project:id:${projectId}:aud`);
  }
  return scopes.join(' ');
};

/**
 * Resolves the secret used to sign and verify auth tokens.
 * Published example values are refused everywhere, and production requires TR_SECRET. Elsewhere an unset TR_SECRET
 * gets a random per-process secret, so sign-ins do not survive a restart but tokens can never be forged.
 */
export const resolveSecret = (secret: string | undefined, nodeEnv: string | undefined): string => {
  if (secret && isPublishedSecret(secret)) {
    throw new Error(
      'TR_SECRET is set to a publicly known example value. Set it to a unique random value, e.g. the output of `openssl rand -hex 32`.',
    );
  }
  if (nodeEnv === 'production' && !secret) {
    throw new Error('TR_SECRET must be set to a unique random value in production, e.g. the output of `openssl rand -hex 32`.');
  }
  return secret || randomBytes(32).toString('hex');
};

export const config = {
  env: env.NODE_ENV || 'dev',
  port: parseInt(env.TR_PORT, 10) || 8080,
  secret: resolveSecret(env.TR_SECRET, env.NODE_ENV),
  virtualHost: env.TR_VIRTUAL_HOST || 'http://localhost:8080',
  publicDir: env.TR_PUBLIC_DIR || join(__dirname, '../public'),
  templatesDir: env.TR_TEMPLATES_DIR || join(__dirname, '../src/templates'),
  corsEnabled: getBoolOrDefault(env.TR_CORS_ENABLED, false),
  accessLogsEnabled: getBoolOrDefault(env.TR_ACCESS_LOGS_ENABLED, true),
  authTokenExpires: parseInt(env.TR_AUTH_TOKEN_EXPIRES, 10) || 86400,
  signupsEnabled: getBoolOrDefault(env.TR_SIGNUPS_ENABLED, true),
  maxProjectsPerUser: parseInt(env.TR_MAX_PROJECTS_PER_USER, 10) || 100,
  defaultProjectPlan: env.TR_DEFAULT_PROJECT_PLAN || 'open-source',
  autoMigrate: getBoolOrDefault(env.TR_DB_AUTOMIGRATE, true),
  seedData: getBoolOrDefault(env.TR_SEED_DATA, true),
  import: {
    maxNestedLevels: parseInt(env.TR_IMPORT_MAX_NESTED_LEVELS, 10) || 100,
  },
  // Optional Ever Platform features. Anonymous usage statistics are on unless TR_EVER_STATS_ENABLED is exactly 'false'
  // (then not loaded at all); see docs/ever-platform/anonymous-usage-statistics.md
  everPlatform: readEverPlatformConfig(env),
  providers: {
    google: {
      active: getBoolOrDefault(env.TR_AUTH_GOOGLE_ENABLED, false),
      clientSecret: env.TR_AUTH_GOOGLE_CLIENT_SECRET,
      clientId: env.TR_AUTH_GOOGLE_CLIENT_ID,
      redirectUrl: env.TR_AUTH_GOOGLE_REDIRECT_URL,
      apiUrl: 'https://www.googleapis.com/oauth2/v4/token',
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
    },
    // Optional sign-in with Ever ID or any other OpenID Connect issuer. Off unless TR_AUTH_EVERID_ENABLED is 'true';
    // when off, nothing is requested from the issuer and the provider is not listed.
    everid: {
      kind: 'oidc' as const,
      active: getBoolOrDefault(env.TR_AUTH_EVERID_ENABLED, false),
      issuer: env.TR_AUTH_EVERID_ISSUER,
      allowedIssuers: getListOrDefault(env.TR_AUTH_EVERID_ALLOWED_ISSUERS),
      clientId: env.TR_AUTH_EVERID_CLIENT_ID,
      clientSecret: env.TR_AUTH_EVERID_CLIENT_SECRET,
      redirectUrl: env.TR_AUTH_EVERID_REDIRECT_URL,
      platformProjectId: env.TR_AUTH_EVERID_PLATFORM_PROJECT_ID,
      scope: everIdScope(env.TR_AUTH_EVERID_PLATFORM_PROJECT_ID),
      pkce: true,
      backchannelLogoutEnabled: getBoolOrDefault(env.TR_AUTH_EVERID_BACKCHANNEL_LOGOUT_ENABLED, true),
      // An issuer on an Ever host is used only by an Ever-operated install ('cloud')
      installSource: env.TR_EVER_INSTALL_SOURCE,
      // Filled from the issuer's discovery document at boot, when the provider is enabled
      url: undefined as string | undefined,
      apiUrl: undefined as string | undefined,
      jwksUri: undefined as string | undefined,
      endSessionEndpoint: undefined as string | undefined,
    },
  },
  mail: {
    debug: getBoolOrDefault(env.TR_MAIL_DEBUG, false),
    sender: env.TR_MAIL_SENDER,
    host: env.TR_MAIL_HOST,
    port: parseInt(env.TR_MAIL_PORT, 10) || 587,
    secure: getBoolOrDefault(env.TR_MAIL_SECURE, false),
    rejectSelfSigned: getBoolOrDefault(env.TR_MAIL_REJECT_SELF_SIGNED, true),
    auth: {
      user: env.TR_MAIL_USER,
      pass: env.TR_MAIL_PASSWORD,
    },
  },
  db: {
    default: {
      type: env.TR_DB_TYPE || 'better-sqlite3',
      host: env.TR_DB_HOST || '127.0.0.1',
      port: parseInt(env.TR_DB_PORT, 10) || 3306,
      username: env.TR_DB_USER || 'root',
      password: env.TR_DB_PASSWORD || '',
      database: env.TR_DB_DATABASE || 'data/tr_dev.sqlite3',
      // forcing typeorm to use (mysql2) if both (mysql/mysql2) packages found, it prioritize to load (mysql)
      connectorPackage: 'mysql2',
      charset: 'utf8mb4',
      synchronize: false,
      logging: false,
      keepConnectionAlive: true,
      entities: ['src/entity/*.entity*'],
      migrations: ['src/migrations/*'],
      namingStrategy: env.TR_DB_TYPE === 'postgres' || env.TR_DB_TYPE === 'better-sqlite3' ? new SnakeNamingStrategy() : new DefaultNamingStrategy(),
    } as TypeOrmModuleOptions,
  },

  throttle: {
    global: {
      ttl: getNumberOrDefault(env.TR_THROTTLE_TTL, 0),
      limit: getNumberOrDefault(env.TR_THROTTLE_LIMIT, 0),
    },
    auth: {
      ttl: getNumberOrDefault(env.TR_AUTH_THROTTLE_TTL, 60000),
      limit: getNumberOrDefault(env.TR_AUTH_THROTTLE_LIMIT, env.NODE_ENV === 'production' ? 100 : 10),
    },
  },

  loginAttempts: {
    ttl: getNumberOrDefault(env.TR_LOGIN_ATTEMPTS_TTL, 900000),
    maxAttempts: getNumberOrDefault(env.TR_LOGIN_ATTEMPTS_MAX, 3),
  },

  defaultAdminCredentialConfig: {
    adminEmail: process.env.TR_ADMIN_EMAIL || `local.admin@ever.co`,
    // No default: the seed creates the admin only when a password is configured
    adminPassword: process.env.TR_ADMIN_PASSWORD || '',
    adminName: process.env.TR_ADMIN_NAME || 'Admin',
  },
};
