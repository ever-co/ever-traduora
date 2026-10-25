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
  providers: {
    google: {
      active: getBoolOrDefault(env.TR_AUTH_GOOGLE_ENABLED, false),
      clientSecret: env.TR_AUTH_GOOGLE_CLIENT_SECRET,
      clientId: env.TR_AUTH_GOOGLE_CLIENT_ID,
      redirectUrl: env.TR_AUTH_GOOGLE_REDIRECT_URL,
      apiUrl: 'https://www.googleapis.com/oauth2/v4/token',
      url: 'https://accounts.google.com/o/oauth2/v2/auth',
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
