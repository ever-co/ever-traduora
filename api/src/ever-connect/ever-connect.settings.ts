import { version as apiVersion } from '../../package.json';
import { config } from '../config';
import { ConnectFeedMode, InstallSource } from '../ever-platform/env';

/** The settings of the Ever Platform connection, read once at boot. */
export interface EverConnectSettings {
  /** The Ever Platform API (`TR_EVER_PLATFORM_API_URL`), or `null` when the configured address cannot be used. */
  apiUrl: string | null;
  /** Declared by `TR_EVER_INSTALL_SOURCE`, never inferred. */
  installSource: InstallSource;
  /** The API release (`api/package.json`). */
  version: string;
  /** A connect code to redeem once at boot (`TR_EVER_CONNECT_CODE`). */
  connectCode: string | null;
  /** Integration keys the operator denies here (`TR_EVER_CONNECT_INTEGRATIONS_DENY`). */
  integrationsDeny: ReadonlyArray<string>;
  feedMode: ConnectFeedMode;
  /** For a local test platform only (ignored by the SDK otherwise). */
  issuer: string | null;
  rootKeysFile: string | null;
  /** Whether the anonymous usage statistics are loaded (the `stats_link` integration needs their key). */
  statsLoaded: boolean;
  /** Whether the hand-off provisioning routes answer (`TR_EVER_CONNECT_PROVISION_ENABLED=true`); off when unset. */
  provisionEnabled?: boolean;
  /** The address people open this installation at (`TR_VIRTUAL_HOST`), sent to Ever Platform with a provisioning. */
  appUrl?: string;
}

export const EVER_CONNECT_SETTINGS = Symbol('ever connect settings');

/** A version Ever Platform accepts: `major.minor.patch` with an optional short suffix. */
function platformVersion(raw: string | undefined): string {
  const value = (raw || '').trim();
  return /^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(-[0-9A-Za-z.]{1,16})?$/.test(value) ? value : '0.0.0';
}

export function readEverConnectSettings(): EverConnectSettings {
  const everPlatform = config.everPlatform;
  return {
    apiUrl: everPlatform.apiUrl,
    installSource: everPlatform.installSource,
    version: platformVersion(apiVersion),
    connectCode: everPlatform.connectCode,
    integrationsDeny: everPlatform.connectIntegrationsDeny,
    feedMode: everPlatform.connectFeedMode,
    issuer: everPlatform.platformIssuer,
    rootKeysFile: everPlatform.platformRootKeysFile,
    statsLoaded: everPlatform.statsEnabled,
    provisionEnabled: everPlatform.connectProvisionEnabled,
    appUrl: config.virtualHost,
  };
}
