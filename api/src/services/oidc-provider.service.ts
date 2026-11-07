import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { decodeJwt, importJWK, JWK, JWTHeaderParameters, JWTPayload, jwtVerify, KeyLike } from 'jose';
import { firstValueFrom } from 'rxjs';
import { config } from '../config';

/** A discovery document is reused for 24 hours; when a refresh fails, one up to 7 days old is still used. */
export const OIDC_DISCOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const OIDC_DISCOVERY_MAX_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/** A key set is reused for 600 s. */
export const OIDC_JWKS_TTL_MS = 600 * 1000;

/** A token signed with an unknown `kid` causes at most one refetch of the key set per 30 s. */
export const OIDC_JWKS_REFETCH_COOLDOWN_MS = 30 * 1000;

/** When a key set refresh fails, a set up to 21,600 s (6 h) old is still used. */
export const OIDC_JWKS_MAX_STALE_MS = 21_600 * 1000;

/** Clock tolerance for `exp` and for tokens dated slightly in the future, seconds. */
export const OIDC_CLOCK_TOLERANCE_SECONDS = 60;

/** An ID token may be dated at most this far in the future, seconds. */
export const OIDC_MAX_IAT_SKEW_SECONDS = 300;

/** A back-channel logout token older than this is refused, seconds. */
export const OIDC_LOGOUT_TOKEN_MAX_AGE_SECONDS = 300;

/** At most this many issuers are accepted: the configured one and up to two more. */
export const OIDC_MAX_ISSUERS = 3;

/** Requests to the issuer give up after this long, milliseconds. */
export const OIDC_HTTP_TIMEOUT_MS = 10 * 1000;

/** Signature algorithms accepted on tokens; never `none` or a symmetric one. */
export const OIDC_SIGNING_ALGORITHMS = ['RS256', 'ES256', 'EdDSA'];

/**
 * The event a back-channel logout token carries (OpenID Connect Back-Channel Logout 1.0, section 2.4). An identifier
 * compared as a string, never requested.
 */
export const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

export type OidcErrorCode =
  | 'provider_disabled'
  | 'discovery_failed'
  | 'exchange_failed'
  | 'token_invalid'
  | 'expired'
  | 'issuer_rejected'
  | 'audience_rejected'
  | 'nonce_mismatch'
  | 'email_unverified'
  | 'jwks_unavailable';

/** A failure of the OpenID Connect flow. Its message never contains a token. */
export class OidcError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OidcError';
  }
}

/** The OpenID Provider metadata fields used here (OpenID Connect Discovery 1.0, section 3). */
export interface OidcDiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
  token_endpoint_auth_methods_supported?: string[];
}

/** The identity an ID token proves, after verification. */
export interface OidcIdentity {
  issuer: string;
  subject: string;
  email: string;
  emailVerified: boolean;
  name: string;
  /** The issuer's session id, when it sends one (back-channel logout names it) */
  sid?: string;
  /** When the person last authenticated at the issuer, seconds since the epoch */
  authTime?: number;
  /** Ever Platform person id (`urn:ever:person_id`): stored with a link, never used to find an account */
  personId?: string;
}

/** A verified back-channel logout token. */
export interface OidcLogout {
  issuer: string;
  subject?: string;
  sid?: string;
  jti: string;
  iat: number;
}

/** The entry `GET /auth/providers` lists for an active OpenID Connect provider. Never holds the client secret. */
export interface OidcProviderEntry {
  slug: string;
  url: string;
  redirectUrl: string;
  clientId: string;
  scope: string;
  pkce: boolean;
}

interface OidcProviderRuntime {
  slug: string;
  issuer: string;
  issuers: string[];
  clientId: string;
  clientSecret: string;
  redirectUrl: string;
  scope: string;
  backchannelLogoutEnabled: boolean;
}

interface OidcProviderSettings {
  kind?: string;
  active?: boolean;
  issuer?: string;
  allowedIssuers?: string[];
  clientId?: string;
  clientSecret?: string;
  redirectUrl?: string;
  scope?: string;
  backchannelLogoutEnabled?: boolean;
  installSource?: string;
  url?: string;
  apiUrl?: string;
  jwksUri?: string;
  endSessionEndpoint?: string;
}

interface Cached<T> {
  value: T;
  fetchedAt: number;
}

/** The slugs of the configured OpenID Connect providers (today `everid`). */
export function oidcProviderSlugs(): string[] {
  return Object.keys(config.providers).filter(slug => (config.providers[slug] as OidcProviderSettings).kind === 'oidc');
}

/** Removes trailing slashes. */
export function stripTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value.charAt(end - 1) === '/') {
    end--;
  }
  return value.slice(0, end);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** An issuer must use https; plain http only on the local machine (development and tests). */
export function isAcceptableIssuer(issuer: string): boolean {
  try {
    const url = new URL(issuer);
    return url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

/** Whether an issuer is on an Ever host (`ever.co` or a subdomain). Parses the URL only, never resolves it. */
export function isEverHost(issuer: string): boolean {
  try {
    const host = new URL(issuer).hostname.toLowerCase().replace(/\.$/, '');
    return host === 'ever.co' || host.endsWith('.ever.co');
  } catch {
    return false;
  }
}

/** Whether two absolute URLs share scheme, host and port. */
export function isSameOrigin(url: unknown, issuer: string): boolean {
  if (typeof url !== 'string' || !url) {
    return false;
  }
  try {
    return new URL(url).origin === new URL(issuer).origin;
  } catch {
    return false;
  }
}

/** Whether a key can verify a signature made with `alg`: the key type is pinned to the algorithm. */
export function isKeyCompatible(jwk: JWK, alg: string): boolean {
  if (jwk.use && jwk.use !== 'sig') {
    return false;
  }
  if (jwk.alg && jwk.alg !== alg) {
    return false;
  }
  switch (alg) {
    case 'RS256':
      return jwk.kty === 'RSA';
    case 'ES256':
      return jwk.kty === 'EC' && jwk.crv === 'P-256';
    case 'EdDSA':
      return jwk.kty === 'OKP' && jwk.crv === 'Ed25519';
    default:
      return false;
  }
}

/** Picks the key for a token: by `kid`, or the only compatible key when the token names none. */
export function selectKey(keys: JWK[], alg: string | undefined, kid: string | undefined): JWK | undefined {
  if (!alg || !OIDC_SIGNING_ALGORITHMS.includes(alg)) {
    return undefined;
  }
  const candidates = keys.filter(jwk => isKeyCompatible(jwk, alg));
  if (kid) {
    return candidates.find(jwk => jwk.kid === kid);
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

const stringClaim = (payload: JWTPayload, name: string): string | undefined => {
  const value = payload[name];
  return typeof value === 'string' && value ? value : undefined;
};

const audienceList = (payload: JWTPayload): string[] => {
  if (Array.isArray(payload.aud)) {
    return payload.aud;
  }
  return payload.aud ? [payload.aud] : [];
};

const isJsonObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * OpenID Connect providers (today Ever ID, slug `everid`): discovery, the authorization code exchange (with the PKCE
 * verifier from the webapp), and the verification of ID tokens and back-channel logout tokens against the issuer's
 * published keys.
 *
 * A provider is active only when `TR_AUTH_EVERID_ENABLED` is 'true', its settings are complete, its issuer is accepted
 * and the discovery at boot succeeded. Otherwise nothing is ever requested from the issuer, the provider is not
 * listed, and its code paths answer 400. A failed discovery leaves it off with one warning; it never stops the app.
 */
@Injectable()
export class OidcProviderService implements OnModuleInit {
  private readonly logger = new Logger('OidcProviderService');
  private readonly providers = new Map<string, OidcProviderRuntime>();
  private readonly discoveryCache = new Map<string, Cached<OidcDiscoveryDocument>>();
  private readonly jwksCache = new Map<string, Cached<JWK[]>>();
  private readonly jwksInFlight = new Map<string, Promise<Cached<JWK[]>>>();
  private readonly lastForcedRefetch = new Map<string, number>();

  constructor(private readonly http: HttpService) {}

  async onModuleInit(): Promise<void> {
    for (const slug of oidcProviderSlugs()) {
      await this.activate(slug);
    }
  }

  /** Whether `slug` names an OpenID Connect provider (active or not). */
  handles(slug: string): boolean {
    return oidcProviderSlugs().includes(slug);
  }

  isActive(slug: string): boolean {
    return this.providers.has(slug);
  }

  /** The issuer new links are made with; tokens of the other accepted issuers only sign in existing links. */
  primaryIssuer(slug: string): string | undefined {
    return this.providers.get(slug)?.issuer;
  }

  isBackchannelLogoutEnabled(slug: string): boolean {
    return !!this.providers.get(slug)?.backchannelLogoutEnabled;
  }

  /** What `GET /auth/providers` lists for an active provider, or `undefined`. */
  providerEntry(slug: string): OidcProviderEntry | undefined {
    const provider = this.providers.get(slug);
    const document = provider && this.discoveryCache.get(provider.issuer)?.value;
    if (!provider || !document) {
      return undefined;
    }
    return {
      slug,
      url: document.authorization_endpoint,
      redirectUrl: provider.redirectUrl,
      clientId: provider.clientId,
      scope: provider.scope,
      pkce: true,
    };
  }

  /**
   * Exchanges an authorization code (with the PKCE verifier) at the issuer's token endpoint.
   *
   * @returns The token response; only its `id_token` is used, and no token is ever stored or logged.
   */
  async exchangeCode(slug: string, code: string, codeVerifier: string | undefined): Promise<{ id_token: string }> {
    const provider = this.requireProvider(slug);
    if (!code || typeof code !== 'string' || !codeVerifier || typeof codeVerifier !== 'string') {
      throw new OidcError('exchange_failed', 'The authorization code and the PKCE verifier are required');
    }
    const document = await this.discovery(provider.issuer);

    const form: Record<string, string> = {
      grant_type: 'authorization_code',
      code,
      redirect_uri: provider.redirectUrl,
      code_verifier: codeVerifier,
    };
    const headers: Record<string, string> = { Accept: 'application/json' };
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const methods = document.token_endpoint_auth_methods_supported;
    if (Array.isArray(methods) && !methods.includes('client_secret_basic') && methods.includes('client_secret_post')) {
      form.client_id = provider.clientId;
      form.client_secret = provider.clientSecret;
    } else {
      // client_secret_basic (RFC 6749, section 2.3.1): id and secret are form-encoded before they are joined
      const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
      headers.Authorization = `Basic ${Buffer.from(`${encode(provider.clientId)}:${encode(provider.clientSecret)}`).toString('base64')}`;
    }

    let status: number;
    let data: any;
    try {
      ({ status, data } = await this.post(document.token_endpoint, new URLSearchParams(form).toString(), headers));
    } catch {
      throw new OidcError('exchange_failed', 'The token endpoint could not be reached');
    }
    if (status !== 200 || !data || typeof data.id_token !== 'string') {
      throw new OidcError('exchange_failed', `The token endpoint answered ${status}`);
    }
    return { id_token: data.id_token };
  }

  /**
   * Verifies an ID token: signature with the issuer's published keys, `iss` among the accepted issuers, `aud` holding
   * the client id (and `azp` naming it when there are several audiences), `exp`, `iat`, the `nonce` sent with the
   * authorization request, and `email_verified === true`.
   */
  async verifyIdToken(slug: string, idToken: string, nonce: string): Promise<OidcIdentity> {
    const provider = this.requireProvider(slug);
    if (!nonce || typeof nonce !== 'string') {
      throw new OidcError('nonce_mismatch', 'The nonce of the authorization request is required');
    }
    const payload = await this.verifyJwt(provider, idToken, ['sub', 'exp', 'iat']);

    const azp = stringClaim(payload, 'azp');
    if (audienceList(payload).length > 1 && !azp) {
      throw new OidcError('audience_rejected', 'A token for several audiences must name its authorized party');
    }
    if (azp && azp !== provider.clientId) {
      throw new OidcError('audience_rejected', 'The authorized party is not this client');
    }
    if (Number(payload.iat) > this.nowSeconds() + OIDC_MAX_IAT_SKEW_SECONDS) {
      throw new OidcError('token_invalid', 'The ID token is issued in the future');
    }
    if (payload.nonce !== nonce) {
      throw new OidcError('nonce_mismatch', 'The ID token nonce does not match');
    }
    const email = stringClaim(payload, 'email');
    if (!email || payload.email_verified !== true) {
      throw new OidcError('email_unverified', 'The issuer does not report a verified email');
    }

    const authTime = Number(payload.auth_time);
    const fullName = [stringClaim(payload, 'given_name'), stringClaim(payload, 'family_name')].filter(Boolean).join(' ');
    return {
      issuer: payload.iss,
      subject: payload.sub,
      email,
      emailVerified: true,
      name: stringClaim(payload, 'name') || fullName || stringClaim(payload, 'preferred_username') || email.split('@')[0],
      sid: stringClaim(payload, 'sid'),
      authTime: Number.isFinite(authTime) ? authTime : undefined,
      personId: stringClaim(payload, 'urn:ever:person_id'),
    };
  }

  /**
   * Verifies a back-channel logout token (OpenID Connect Back-Channel Logout 1.0, section 2.6): signature, `iss`,
   * `aud`, `iat` at most 300 s old, `jti`, the back-channel logout event, `sid` or `sub`, and no `nonce`. Remembering
   * the `jti` against replays is the caller's job.
   */
  async verifyLogoutToken(slug: string, logoutToken: string): Promise<OidcLogout> {
    const provider = this.requireProvider(slug);
    const payload = await this.verifyJwt(provider, logoutToken, ['iat', 'jti']);

    const iat = Number(payload.iat);
    const now = this.nowSeconds();
    if (!Number.isFinite(iat) || now - iat > OIDC_LOGOUT_TOKEN_MAX_AGE_SECONDS) {
      throw new OidcError('expired', 'The logout token is too old');
    }
    if (iat > now + OIDC_CLOCK_TOLERANCE_SECONDS) {
      throw new OidcError('token_invalid', 'The logout token is issued in the future');
    }
    const jti = stringClaim(payload, 'jti');
    if (!jti) {
      throw new OidcError('token_invalid', 'The logout token has no jti');
    }
    const events = payload.events;
    if (!isJsonObject(events) || !isJsonObject(events[BACKCHANNEL_LOGOUT_EVENT])) {
      throw new OidcError('token_invalid', 'The logout token carries no back-channel logout event');
    }
    if ('nonce' in payload) {
      throw new OidcError('token_invalid', 'A logout token must not carry a nonce');
    }
    const subject = stringClaim(payload, 'sub');
    const sid = stringClaim(payload, 'sid');
    if (!subject && !sid) {
      throw new OidcError('token_invalid', 'The logout token names neither a session nor a subject');
    }
    return { issuer: payload.iss, subject, sid, jti, iat };
  }

  /** Current time in milliseconds; a method so that tests can move the clock. */
  protected now(): number {
    return Date.now();
  }

  private nowSeconds(): number {
    return Math.floor(this.now() / 1000);
  }

  private requireProvider(slug: string): OidcProviderRuntime {
    const provider = this.providers.get(slug);
    if (!provider) {
      throw new OidcError('provider_disabled', `The sign-in provider ${slug} is not enabled`);
    }
    return provider;
  }

  /**
   * Turns the provider on when it is enabled and complete. Logs one line and leaves it off otherwise; never throws.
   */
  private async activate(slug: string): Promise<void> {
    this.providers.delete(slug);
    const settings = config.providers[slug] as OidcProviderSettings;
    Object.assign(settings, { url: undefined, apiUrl: undefined, jwksUri: undefined, endSessionEndpoint: undefined });
    if (!settings.active) {
      // Off: nothing is requested from the issuer
      return;
    }

    const prefix = `TR_AUTH_${slug.toUpperCase()}`;
    const missing = ['ISSUER', 'CLIENT_ID', 'CLIENT_SECRET', 'REDIRECT_URL'].filter(name => {
      const key = { ISSUER: 'issuer', CLIENT_ID: 'clientId', CLIENT_SECRET: 'clientSecret', REDIRECT_URL: 'redirectUrl' }[name];
      return !settings[key];
    });
    if (missing.length) {
      this.logger.warn(`Sign-in provider ${slug} stays off: ${missing.map(name => `${prefix}_${name}`).join(', ')} not set.`);
      return;
    }

    const issuer = stripTrailingSlashes(settings.issuer.trim());
    const extra = (settings.allowedIssuers || []).map(value => stripTrailingSlashes(value)).filter(value => value !== issuer);
    const issuers = [issuer, ...Array.from(new Set(extra))];
    if (issuers.length > OIDC_MAX_ISSUERS) {
      this.logger.warn(`Sign-in provider ${slug}: only the first ${OIDC_MAX_ISSUERS - 1} of ${prefix}_ALLOWED_ISSUERS are accepted.`);
      issuers.length = OIDC_MAX_ISSUERS;
    }
    if (!issuers.every(isAcceptableIssuer)) {
      this.logger.warn(`Sign-in provider ${slug} stays off: every issuer must use https (http only on the local machine).`);
      return;
    }
    // An issuer on an Ever host is used only by an Ever-operated install. Decided from the configured URLs alone,
    // before any request, so such an install makes no request to an Ever host for this provider.
    if (issuers.some(isEverHost) && (settings.installSource || '').trim() !== 'cloud') {
      this.logger.warn(`Sign-in provider ${slug} stays off: an Ever ID issuer is used only by the Ever-operated Traduora cloud.`);
      return;
    }

    let document: OidcDiscoveryDocument;
    try {
      document = await this.discovery(issuer);
    } catch (error) {
      this.logger.warn(`Sign-in provider ${slug} stays off: discovery failed for ${issuer} (${error?.code ?? 'unexpected error'}).`);
      return;
    }

    this.providers.set(slug, {
      slug,
      issuer,
      issuers,
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUrl: settings.redirectUrl,
      scope: settings.scope,
      backchannelLogoutEnabled: settings.backchannelLogoutEnabled !== false,
    });
    Object.assign(settings, {
      url: document.authorization_endpoint,
      apiUrl: document.token_endpoint,
      jwksUri: document.jwks_uri,
      endSessionEndpoint: document.end_session_endpoint,
    });
    this.logger.log(`Sign-in provider ${slug} is on (issuer ${issuer}).`);
  }

  /** Verifies signature, `iss` (among the accepted issuers), `aud` (the client id) and `exp`. */
  private async verifyJwt(provider: OidcProviderRuntime, token: string, requiredClaims: string[]): Promise<JWTPayload> {
    if (!token || typeof token !== 'string') {
      throw new OidcError('token_invalid', 'Missing token');
    }
    // The issuer named by the token only picks which accepted issuer's keys to verify it with
    let issuer: string;
    try {
      issuer = decodeJwt(token).iss;
    } catch {
      throw new OidcError('token_invalid', 'The token is malformed');
    }
    if (!issuer || !provider.issuers.includes(issuer)) {
      throw new OidcError('issuer_rejected', 'The token issuer is not accepted');
    }
    const getKey = (header: JWTHeaderParameters) => this.getKey(issuer, header.alg, header.kid);
    try {
      const { payload } = await jwtVerify(token, getKey, {
        issuer,
        audience: provider.clientId,
        algorithms: OIDC_SIGNING_ALGORITHMS,
        clockTolerance: OIDC_CLOCK_TOLERANCE_SECONDS,
        currentDate: new Date(this.now()),
        requiredClaims,
      });
      return payload;
    } catch (error) {
      if (error instanceof OidcError) {
        throw error;
      }
      const { code, claim } = (error ?? {}) as { code?: string; claim?: string };
      if (code === 'ERR_JWT_EXPIRED') {
        throw new OidcError('expired', 'The token expired');
      }
      if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'iss') {
        throw new OidcError('issuer_rejected', 'The token issuer is not accepted');
      }
      if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED' && claim === 'aud') {
        throw new OidcError('audience_rejected', 'The token audience is not accepted');
      }
      throw new OidcError('token_invalid', code ? `The token is rejected (${code})` : 'The token is rejected');
    }
  }

  /**
   * Returns the key that verifies a token of `issuer`. A `kid` missing from the cached set causes one refetch at most
   * every 30 s per issuer; a second unknown `kid` within that window is rejected without a request.
   */
  private async getKey(issuer: string, alg: string | undefined, kid: string | undefined): Promise<KeyLike | Uint8Array> {
    if (!alg || !OIDC_SIGNING_ALGORITHMS.includes(alg)) {
      throw new OidcError('token_invalid', 'The signature algorithm is not accepted');
    }
    const first = await this.keySet(issuer, false);
    let jwk = selectKey(first.keys, alg, kid);
    if (!jwk) {
      const now = this.now();
      if (first.fresh) {
        // Fetched by this very call: fetching again cannot help
        this.lastForcedRefetch.set(issuer, now);
        throw new OidcError('token_invalid', 'No matching signing key');
      }
      if (now - (this.lastForcedRefetch.get(issuer) ?? 0) < OIDC_JWKS_REFETCH_COOLDOWN_MS) {
        throw new OidcError('token_invalid', 'No matching signing key');
      }
      this.lastForcedRefetch.set(issuer, now);
      jwk = selectKey((await this.keySet(issuer, true)).keys, alg, kid);
    }
    if (!jwk) {
      throw new OidcError('token_invalid', 'No matching signing key');
    }
    return importJWK(jwk, alg);
  }

  private async keySet(issuer: string, force: boolean): Promise<{ keys: JWK[]; fresh: boolean }> {
    const cached = this.jwksCache.get(issuer);
    const now = this.now();
    if (!force && cached && now - cached.fetchedAt < OIDC_JWKS_TTL_MS) {
      return { keys: cached.value, fresh: false };
    }
    let pending = this.jwksInFlight.get(issuer);
    if (!pending) {
      pending = this.fetchKeySet(issuer).finally(() => this.jwksInFlight.delete(issuer));
      this.jwksInFlight.set(issuer, pending);
    }
    try {
      return { keys: (await pending).value, fresh: true };
    } catch (error) {
      if (cached && now - cached.fetchedAt < OIDC_JWKS_MAX_STALE_MS) {
        this.logger.warn(`Using a cached key set for ${issuer}: the refresh failed.`);
        return { keys: cached.value, fresh: false };
      }
      throw error instanceof OidcError && error.code === 'jwks_unavailable' ? error : new OidcError('jwks_unavailable', `No key set for ${issuer}`);
    }
  }

  private async fetchKeySet(issuer: string): Promise<Cached<JWK[]>> {
    const document = await this.discovery(issuer);
    let status: number;
    let data: any;
    try {
      ({ status, data } = await this.get(document.jwks_uri));
    } catch {
      throw new OidcError('jwks_unavailable', `The key set of ${issuer} could not be reached`);
    }
    if (status !== 200 || !data || !Array.isArray(data.keys)) {
      throw new OidcError('jwks_unavailable', `The key set of ${issuer} answered ${status}`);
    }
    const keys = data.keys.filter(key => isJsonObject(key) && typeof key.kty === 'string') as JWK[];
    const cached = { value: keys, fetchedAt: this.now() };
    this.jwksCache.set(issuer, cached);
    return cached;
  }

  /**
   * Returns the issuer's discovery document. It is accepted only when its `issuer` is exactly the configured one and
   * its endpoints are on the issuer's own origin, so only the configured issuer is ever contacted.
   */
  private async discovery(issuer: string): Promise<OidcDiscoveryDocument> {
    const cached = this.discoveryCache.get(issuer);
    const now = this.now();
    if (cached && now - cached.fetchedAt < OIDC_DISCOVERY_TTL_MS) {
      return cached.value;
    }
    try {
      const { status, data } = await this.get(`${issuer}/.well-known/openid-configuration`);
      if (status !== 200 || !isJsonObject(data)) {
        throw new OidcError('discovery_failed', `Discovery answered ${status}`);
      }
      const document = this.validateDiscovery(issuer, data as unknown as OidcDiscoveryDocument);
      this.discoveryCache.set(issuer, { value: document, fetchedAt: this.now() });
      return document;
    } catch (error) {
      if (cached && now - cached.fetchedAt < OIDC_DISCOVERY_MAX_STALE_MS) {
        this.logger.warn(`Using a cached discovery document for ${issuer}: the refresh failed.`);
        return cached.value;
      }
      throw error instanceof OidcError ? error : new OidcError('discovery_failed', `Discovery failed for ${issuer}`);
    }
  }

  private validateDiscovery(issuer: string, document: OidcDiscoveryDocument): OidcDiscoveryDocument {
    if (document.issuer !== issuer) {
      throw new OidcError('discovery_failed', 'The discovery document names another issuer');
    }
    for (const key of ['authorization_endpoint', 'token_endpoint', 'jwks_uri'] as const) {
      if (!isSameOrigin(document[key], issuer)) {
        throw new OidcError('discovery_failed', `The discovery document's ${key} is not on the issuer's origin`);
      }
    }
    if (document.end_session_endpoint !== undefined && !isSameOrigin(document.end_session_endpoint, issuer)) {
      throw new OidcError('discovery_failed', `The discovery document's end_session_endpoint is not on the issuer's origin`);
    }
    return document;
  }

  private async get(url: string): Promise<{ status: number; data: any }> {
    const { status, data } = await firstValueFrom(
      this.http.get(url, {
        timeout: OIDC_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        headers: { Accept: 'application/json' },
        validateStatus: () => true,
      }),
    );
    return { status, data };
  }

  private async post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; data: any }> {
    const { status, data } = await firstValueFrom(
      this.http.post(url, body, {
        timeout: OIDC_HTTP_TIMEOUT_MS,
        maxRedirects: 0,
        maxContentLength: 1024 * 1024,
        headers,
        validateStatus: () => true,
      }),
    );
    return { status, data };
  }
}
