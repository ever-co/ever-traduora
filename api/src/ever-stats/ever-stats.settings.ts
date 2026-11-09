import { version as apiVersion } from '../../package.json';
import { config, EverInstallSource } from '../config';

export type ReleaseChannel = 'stable' | 'rc' | 'beta' | 'dev' | 'custom';

/** The release this API runs, without any suffix (a fork's build string could name a company). */
export interface ReleaseVersion {
  version: string;
  channel: ReleaseChannel;
}

/** The settings of the anonymous usage statistics, read once at startup (tests replace them). */
export interface EverStatsSettings {
  /** Where reports go (`POST {apiUrl}/v1/stats/reports`), or null when the configured address cannot be used. */
  apiUrl: string | null;
  /** ISO 3166-1 alpha-2 declared by the operator, or `ZZ`. Never derived from data or addresses. */
  country: string;
  /** Seconds between two reports: a day, unless a test overrides it. */
  intervalS: number;
  /** Declared by TR_EVER_INSTALL_SOURCE, never inferred. */
  installSource: EverInstallSource;
  /** The API release, `major.minor.patch`, and its channel. */
  release: ReleaseVersion;
  /** The two allow-listed Traduora features, from the configuration only, read when a report is built. */
  features: () => { google_login: boolean; signups_enabled: boolean };
}

export const EVER_STATS_SETTINGS = Symbol('ever stats settings');

/**
 * Splits a release version into `major.minor.patch` and a channel: `-rc…` rc, `-beta…`/`-alpha…` beta,
 * `-dev…`/`-<n>-g<sha>` dev, any other suffix custom. Without a usable version the report says `0.0.0` on `dev`.
 */
export function parseReleaseVersion(raw: string | undefined): ReleaseVersion {
  const value = (raw ?? '').trim().replace(/^v/i, '');
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

/** The settings from the API configuration (`config.everPlatform`) and `api/package.json`. */
export function everStatsSettingsFromConfig(): EverStatsSettings {
  return {
    apiUrl: config.everPlatform.statsApiUrl,
    country: config.everPlatform.statsCountry,
    intervalS: config.everPlatform.statsSendIntervalS,
    installSource: config.everPlatform.installSource,
    release: parseReleaseVersion(apiVersion),
    features: () => ({
      google_login: config.providers.google.active === true,
      signups_enabled: config.signupsEnabled === true,
    }),
  };
}
