import { version as apiVersion } from '../../package.json';
import { config } from '../config';
import { InstallSource } from '../ever-platform/env';

export type ReleaseChannel = 'stable' | 'rc' | 'beta' | 'dev' | 'custom';

/** The release this API runs, without any suffix (a fork's build string could name a company). */
export interface ReleaseVersion {
  version: string;
  channel: ReleaseChannel;
}

/** The settings of the anonymous usage statistics, read once at boot. */
export interface EverStatsConfig {
  /** Where reports go (`POST {apiUrl}/v1/stats/reports`), or `null` when the configured address cannot be used. */
  apiUrl: string | null;
  /** ISO 3166-1 alpha-2 declared by the operator, or `ZZ`. Never derived from data. */
  country: string;
  /** Seconds between two reports: a day, unless a test overrides it. */
  intervalS: number;
  /** Declared by `TR_EVER_INSTALL_SOURCE`, never inferred. */
  installSource: InstallSource;
  /** The API release, `major.minor.patch`, and its channel. */
  release: ReleaseVersion;
  /** The two allow-listed Traduora features, from configuration only. */
  features: { google_login: boolean; signups_enabled: boolean };
}

export const EVER_STATS_CONFIG = Symbol('ever stats config');

/**
 * Splits a release version into `major.minor.patch` and a channel: `-rc…` rc, `-beta…`/`-alpha…` beta,
 * `-dev…`/`-<n>-g<sha>` dev, any other suffix custom. Without a usable version the report says `0.0.0` on `dev`.
 */
export function parseReleaseVersion(raw: string | undefined): ReleaseVersion {
  const value = (raw || '').trim().replace(/^v/i, '');
  const match = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})(.*)$/.exec(value);
  if (!match) {
    return { version: '0.0.0', channel: 'dev' };
  }
  const suffix = match[4];
  let channel: ReleaseChannel = 'stable';
  if (suffix) {
    if (/^[-.+]rc([.\-+\d]|$)/i.test(suffix)) channel = 'rc';
    else if (/^[-.+](beta|alpha)([.\-+\d]|$)/i.test(suffix)) channel = 'beta';
    else if (/^-\d+-g[0-9a-f]{4,40}$/i.test(suffix) || /^[-.+](dev|snapshot|nightly)([.\-+\d]|$)/i.test(suffix)) channel = 'dev';
    else channel = 'custom';
  }
  return { version: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`, channel };
}

/** The statistics settings from the `everPlatform` block of `config.ts` and the API's own `package.json`. */
export function readEverStatsConfig(): EverStatsConfig {
  return {
    apiUrl: config.everPlatform.statsApiUrl,
    country: config.everPlatform.statsCountry,
    intervalS: config.everPlatform.statsSendIntervalS,
    installSource: config.everPlatform.installSource,
    release: parseReleaseVersion(apiVersion),
    features: {
      google_login: config.providers.google.active === true,
      signups_enabled: config.signupsEnabled === true,
    },
  };
}
