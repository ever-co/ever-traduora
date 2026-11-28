import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet, { HelmetOptions } from 'helmet';

/**
 * The HTTP hardening of DESIGN §3.8, applied to the Express app before any route or static file:
 * - Express `trust proxy` (TR_TRUST_PROXY), so that the rate limits and the bot check see each visitor's own address;
 * - `helmet` with a Content-Security-Policy that allows the app itself, Google Fonts, and, when they are configured,
 *   Cloudflare Turnstile and the Ever ID issuer; HSTS (one year, sub-domains) only when TR_VIRTUAL_HOST is https;
 * - CORS: the TR_CORS_ORIGINS allowlist, else `*` with TR_CORS_ENABLED=true (existing installs), else none.
 */

/** Cloudflare Turnstile's script and challenge frames. */
export const TURNSTILE_ORIGIN = 'https://challenges.cloudflare.com';
/** Google Fonts: the stylesheets, and the font files they load. */
export const GOOGLE_FONTS_STYLES = 'https://fonts.googleapis.com';
export const GOOGLE_FONTS_FILES = 'https://fonts.gstatic.com';

/** One year, in seconds. */
const HSTS_MAX_AGE = 365 * 24 * 60 * 60;

export interface HardeningSettings {
  /** TR_VIRTUAL_HOST: where the app is served */
  virtualHost: string;
  /** Whether the Turnstile widget is used (both keys set) */
  turnstile: boolean;
  /** The Ever ID (OpenID Connect) issuer, when that sign-in is on */
  everIdIssuer?: string;
  trustProxy?: boolean | number | string[];
  corsEnabled: boolean;
  corsOrigins: string[];
}

export const isHttps = (url: string): boolean => {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
};

const originOf = (url: string | undefined): string | undefined => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};

/** The helmet options: CSP, and HSTS only for an https host. Helmet's other headers keep their defaults. */
export function helmetOptions(settings: HardeningSettings): HelmetOptions {
  const https = isHttps(settings.virtualHost);
  const turnstile = settings.turnstile ? [TURNSTILE_ORIGIN] : [];
  const issuer = originOf(settings.everIdIssuer);
  const everId = issuer ? [issuer] : [];
  return {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'self'"],
        formAction: ["'self'", ...everId],
        scriptSrc: ["'self'", ...turnstile],
        scriptSrcAttr: ["'none'"],
        // Angular adds its component styles as <style> elements
        styleSrc: ["'self'", "'unsafe-inline'", GOOGLE_FONTS_STYLES],
        fontSrc: ["'self'", GOOGLE_FONTS_FILES, 'data:'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", ...everId],
        frameSrc: ["'self'", ...turnstile, ...everId],
        // On http (a local install), upgrading would point every request at an https port nobody serves
        ...(https ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: https ? { maxAge: HSTS_MAX_AGE, includeSubDomains: true } : false,
  };
}

/** The CORS options: the allowlist, else `*` for TR_CORS_ENABLED=true, else `undefined` (no CORS headers). */
export function corsOptions(settings: Pick<HardeningSettings, 'corsEnabled' | 'corsOrigins'>): CorsOptions | undefined {
  if (settings.corsOrigins.length > 0) {
    return { origin: settings.corsOrigins };
  }
  return settings.corsEnabled ? { origin: '*' } : undefined;
}

/** Applies all of it to the app; call before the routes and the static files are mounted. */
export function applyHttpHardening(app: NestExpressApplication, settings: HardeningSettings): void {
  if (settings.trustProxy !== undefined) {
    app.set('trust proxy', settings.trustProxy);
  }
  app.use(helmet(helmetOptions(settings)));
  const cors = corsOptions(settings);
  if (cors) {
    app.enableCors(cors);
  }
}
