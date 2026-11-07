/**
 * Test-only OpenID Connect issuer on 127.0.0.1: discovery, key set, an authorize endpoint that consents at once, a
 * token endpoint that checks the client credentials, the redirect URI and the PKCE verifier, and helpers to sign ID
 * tokens and back-channel logout tokens. Keys are generated when it starts.
 */
import { createHash, randomBytes } from 'crypto';
import { createServer, get as httpGet, IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { exportJWK, generateKeyPair, JWK, JWTPayload, KeyLike, SignJWT } from 'jose';

export const BACKCHANNEL_LOGOUT_EVENT = 'http://schemas.openid.net/event/backchannel-logout';

interface PendingCode {
  clientId: string;
  redirectUri: string;
  nonce: string;
  codeChallenge: string;
  claims: JWTPayload;
}

/** Base64url of the SHA-256 of a PKCE verifier (RFC 7636, S256). */
export const codeChallengeOf = (verifier: string) => createHash('sha256').update(verifier, 'ascii').digest('base64url');

/** A fresh PKCE verifier, nonce and state, as the webapp creates them. */
export const newAuthorizationRequest = () => {
  const codeVerifier = randomBytes(32).toString('base64url');
  return {
    codeVerifier,
    codeChallenge: codeChallengeOf(codeVerifier),
    nonce: randomBytes(32).toString('base64url'),
    state: Buffer.from(JSON.stringify({ p: 'everid', n: randomBytes(8).toString('hex') })).toString('base64url'),
  };
};

export class MockOidcIssuer {
  issuer = '';
  kid = 'mock-key-1';
  /** Every request received (method, path and form body), for egress and request-body assertions. */
  readonly requests: Array<{ method: string; path: string; body?: string; authorization?: string }> = [];
  /** Claims merged into the ID token of the next authorization. */
  nextClaims: JWTPayload = {};
  /** When true, the discovery endpoint answers 500. */
  failDiscovery = false;

  private server: Server | null = null;
  private privateKey: KeyLike | null = null;
  private keys: JWK[] = [];
  private readonly codes = new Map<string, PendingCode>();

  constructor(
    readonly clientId: string,
    readonly clientSecret: string,
    private readonly host = '127.0.0.1',
  ) {}

  async start(): Promise<void> {
    await this.rotateKey(this.kid);
    this.server = createServer((req, res) => {
      this.handle(req, res).catch(() => {
        res.statusCode = 500;
        res.end();
      });
    });
    await new Promise<void>(resolve => this.server.listen(0, this.host, resolve));
    const { port } = this.server.address() as AddressInfo;
    this.issuer = `http://${this.host}:${port}`;
  }

  async stop(): Promise<void> {
    if (this.server) {
      // Keep-alive connections of the API under test would otherwise hold the server open
      this.server.closeAllConnections();
      await new Promise<void>(resolve => this.server.close(() => resolve()));
      this.server = null;
    }
  }

  /** Replaces the signing key; the key set then publishes only the new one. */
  async rotateKey(kid: string): Promise<void> {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
    this.privateKey = privateKey;
    this.kid = kid;
    this.keys = [{ ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }];
  }

  /** Signs claims with the issuer's current key (ID token or logout token). */
  sign(claims: JWTPayload, header: Record<string, unknown> = {}): Promise<string> {
    return new SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: this.kid, typ: 'JWT', ...header }).sign(this.privateKey);
  }

  /** Standard ID token claims for `subject`. */
  idTokenClaims(subject: string, overrides: JWTPayload = {}): JWTPayload {
    const now = Math.floor(Date.now() / 1000);
    return {
      iss: this.issuer,
      sub: subject,
      aud: [this.clientId, 'project-audience'],
      azp: this.clientId,
      iat: now,
      exp: now + 300,
      auth_time: now,
      email: `${subject}@example.test`,
      email_verified: true,
      name: `Person ${subject}`,
      sid: `sid-${subject}`,
      ...overrides,
    };
  }

  /** A back-channel logout token for a session (and subject), issued `ageSeconds` ago. */
  logoutToken(claims: { sid?: string; sub?: string; jti?: string }, ageSeconds = 0, overrides: JWTPayload = {}): Promise<string> {
    return this.sign({
      iss: this.issuer,
      aud: this.clientId,
      iat: Math.floor(Date.now() / 1000) - ageSeconds,
      jti: claims.jti ?? randomBytes(12).toString('hex'),
      events: { [BACKCHANNEL_LOGOUT_EVENT]: {} },
      ...(claims.sid ? { sid: claims.sid } : {}),
      ...(claims.sub ? { sub: claims.sub } : {}),
      ...overrides,
    });
  }

  /**
   * Runs the authorization request the webapp would redirect to, consents at once, and returns the code the issuer
   * redirects back with. `claims` are merged into the ID token the code is exchanged for.
   */
  async authorize(params: { redirectUri: string; nonce: string; codeChallenge: string; state?: string }, claims: JWTPayload = {}): Promise<string> {
    this.nextClaims = claims;
    const url = new URL(`${this.issuer}/oauth/v2/authorize`);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: params.redirectUri,
      scope: 'openid profile email',
      state: params.state ?? 'state',
      nonce: params.nonce,
      code_challenge: params.codeChallenge,
      code_challenge_method: 'S256',
    }).toString();
    const location = await new Promise<string>((resolve, reject) => {
      httpGet(url, (res: IncomingMessage) => {
        res.resume();
        resolve(res.headers.location as string);
      }).on('error', reject);
    });
    return new URL(location).searchParams.get('code');
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', this.issuer);
    const body = req.method === 'POST' ? await this.readBody(req) : undefined;
    this.requests.push({ method: req.method ?? 'GET', path: url.pathname, body, authorization: req.headers.authorization });

    if (url.pathname === '/.well-known/openid-configuration') {
      if (this.failDiscovery) {
        return this.json(res, 500, { error: 'unavailable' });
      }
      return this.json(res, 200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/oauth/v2/authorize`,
        token_endpoint: `${this.issuer}/oauth/v2/token`,
        jwks_uri: `${this.issuer}/oauth/v2/keys`,
        end_session_endpoint: `${this.issuer}/oidc/v1/end_session`,
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'private_key_jwt'],
      });
    }
    if (url.pathname === '/oauth/v2/keys') {
      return this.json(res, 200, { keys: this.keys });
    }
    if (url.pathname === '/oauth/v2/authorize') {
      return this.authorizeEndpoint(url.searchParams, res);
    }
    if (url.pathname === '/oauth/v2/token' && req.method === 'POST') {
      return this.tokenEndpoint(req, body, res);
    }
    return this.json(res, 404, { error: 'not_found' });
  }

  private authorizeEndpoint(query: URLSearchParams, res: ServerResponse): void {
    const redirectUri = query.get('redirect_uri') ?? '';
    const target = new URL(redirectUri);
    const code = randomBytes(16).toString('hex');
    this.codes.set(code, {
      clientId: query.get('client_id') ?? '',
      redirectUri,
      nonce: query.get('nonce') ?? '',
      codeChallenge: query.get('code_challenge') ?? '',
      claims: this.nextClaims,
    });
    // The claims belong to this authorization only
    this.nextClaims = {};
    target.searchParams.set('code', code);
    target.searchParams.set('state', query.get('state') ?? '');
    res.statusCode = 302;
    res.setHeader('Location', target.toString());
    res.end();
  }

  private async tokenEndpoint(req: IncomingMessage, rawBody: string, res: ServerResponse): Promise<void> {
    const body = new URLSearchParams(rawBody);
    // client_secret_basic form-encodes id and secret before joining them (RFC 6749, section 2.3.1)
    const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
    const expected = `Basic ${Buffer.from(`${encode(this.clientId)}:${encode(this.clientSecret)}`).toString('base64')}`;
    if (req.headers.authorization !== expected) {
      return this.json(res, 401, { error: 'invalid_client' });
    }
    const pending = this.codes.get(body.get('code') ?? '');
    this.codes.delete(body.get('code') ?? '');
    const challenge = codeChallengeOf(body.get('code_verifier') ?? '');
    if (
      !pending ||
      body.get('grant_type') !== 'authorization_code' ||
      pending.clientId !== this.clientId ||
      pending.redirectUri !== body.get('redirect_uri') ||
      pending.codeChallenge !== challenge
    ) {
      return this.json(res, 400, { error: 'invalid_grant' });
    }
    const subject = String(pending.claims.sub ?? 'person-1');
    const idToken = await this.sign(this.idTokenClaims(subject, { nonce: pending.nonce, ...pending.claims }));
    return this.json(res, 200, { id_token: idToken, access_token: 'opaque-access-token', token_type: 'Bearer', expires_in: 300 });
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise(resolve => {
      let data = '';
      req.on('data', chunk => (data += chunk));
      req.on('end', () => resolve(data));
    });
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
  }
}
