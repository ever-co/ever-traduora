import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { DefaultNamingStrategy } from 'typeorm';

import { join } from 'path';
import * as process from 'process';

import { SnakeNamingStrategy } from './utils/snake-naming-strategy';

const env = process.env;

const getBoolOrDefault = (value: string, defaultValue: boolean) => (value ? value === 'true' : defaultValue);

export const config = {
  env: env.NODE_ENV || 'dev',
  port: parseInt(env.TR_PORT, 10) || 8080,
  secret: env.TR_SECRET || 'secret',
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
  import: {
    maxNestedLevels: parseInt(env.TR_IMPORT_MAX_NESTED_LEVELS, 10) || 100,
  },
  providers: {
    google: {
      active: env.TR_AUTH_GOOGLE_ENABLED,
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
      type: env.TR_DB_TYPE || 'mysql',
      host: env.TR_DB_HOST || '127.0.0.1',
      port: parseInt(env.TR_DB_PORT, 10) || 3306,
      username: env.TR_DB_USER || 'root',
      password: env.TR_DB_PASSWORD || '',
      database: env.TR_DB_DATABASE || 'tr_dev',
      // forcing typeorm to use (mysql2) if both (mysql/mysql2) packages found, it prioritize to load (mysql)
      connectorPackage: 'mysql2',
      charset: 'utf8mb4',
      synchronize: false,
      logging: false,
      keepConnectionAlive: true,
      entities: ['src/entity/*.entity*'],
      migrations: ['src/migrations/*'],
      namingStrategy: env.TR_DB_TYPE === 'postgres' ? new SnakeNamingStrategy() : new DefaultNamingStrategy(),
    } as TypeOrmModuleOptions,
  },
};
