import { config } from '../config';
import { InstallSource, normalizeEmail } from '../ever-platform/env';

/** The settings of the instance identity, read once at boot. */
export interface EverInstanceSettings {
  /** Declared by `TR_EVER_INSTALL_SOURCE`, never inferred. */
  installSource: InstallSource;
  /** The normalized e-mails of the users who operate this installation (`TR_EVER_ADMIN_EMAILS`, else `TR_ADMIN_EMAIL`). */
  adminEmails: ReadonlyArray<string>;
  /**
   * The secret the statistics key is encrypted with: the configured `TR_SECRET` only. Without one, Traduora signs its
   * sessions with a random secret per process, which could not decrypt the key after a restart. Never logged.
   */
  secret: string;
}

export const EVER_INSTANCE_SETTINGS = Symbol('ever instance settings');

export function readEverInstanceSettings(env: Record<string, string | undefined> = process.env): EverInstanceSettings {
  return {
    installSource: config.everPlatform.installSource,
    adminEmails: config.everPlatform.adminEmails.map(normalizeEmail),
    secret: env.TR_SECRET || '',
  };
}
