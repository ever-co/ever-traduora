import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { config, everIdScope } from '../config';
import { MockOidcIssuer } from '../../test/mock-oidc/mock-oidc-issuer';
import * as claimExamples from '../../test/mock-oidc/id-token-claims.example.json';
import {
  BACKCHANNEL_LOGOUT_EVENT,
  isEverHost,
  OIDC_JWKS_MAX_STALE_MS,
  OIDC_JWKS_REFETCH_COOLDOWN_MS,
  OIDC_JWKS_TTL_MS,
  OIDC_REFRESH_RETRY_MS,
  OidcProviderService,
} from './oidc-provider.service';

const CLIENT_ID = 'traduora-client';
const CLIENT_SECRET = 'traduora-client-secret';
const REDIRECT_URL = 'http://localhost:8080/auth/callback';

/** The service with a clock the tests move. */
class ClockedOidcProviderService extends OidcProviderService {
  clock = Date.now();
  protected now(): number {
    return this.clock;
  }
}

describe('OidcProviderService', () => {
  const settings = config.providers.everid;
  const original = { ...settings };
  let issuer: MockOidcIssuer;
  let http: HttpService;
  let service: ClockedOidcProviderService;

  const enable = (overrides: Partial<typeof settings> = {}) =>
    Object.assign(settings, {
      active: true,
      issuer: issuer.issuer,
      allowedIssuers: [],
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      redirectUrl: REDIRECT_URL,
      installSource: undefined,
      ...overrides,
    });

  const start = async () => {
    service = new ClockedOidcProviderService(http);
    await service.onModuleInit();
    return service;
  };

  const requestsTo = (path: string) => issuer.requests.filter(request => request.path === path).length;

  beforeAll(async () => {
    issuer = new MockOidcIssuer(CLIENT_ID, CLIENT_SECRET);
    await issuer.start();
  });

  afterAll(async () => {
    await issuer.stop();
  });

  beforeEach(() => {
    http = new HttpService(axios.create());
    issuer.requests.length = 0;
    issuer.failDiscovery = false;
  });

  afterEach(() => {
    Object.assign(settings, original);
  });

  describe('activation', () => {
    it('is off and requests nothing when TR_AUTH_EVERID_ENABLED is not true', async () => {
      const get = jest.spyOn(http, 'get');
      enable({ active: false });
      await start();
      expect(service.isActive('everid')).toBe(false);
      expect(service.providerEntry('everid')).toBeUndefined();
      expect(get).not.toHaveBeenCalled();
      expect(issuer.requests).toHaveLength(0);
      await expect(service.exchangeCode('everid', 'code', 'v'.repeat(43))).rejects.toMatchObject({ code: 'provider_disabled' });
    });

    it('turns on after one discovery and lists the provider without its secret', async () => {
      enable({ scope: 'openid profile email' });
      await start();
      expect(service.isActive('everid')).toBe(true);
      expect(requestsTo('/.well-known/openid-configuration')).toBe(1);
      const entry = service.providerEntry('everid');
      expect(entry).toEqual({
        slug: 'everid',
        url: `${issuer.issuer}/oauth/v2/authorize`,
        redirectUrl: REDIRECT_URL,
        clientId: CLIENT_ID,
        scope: 'openid profile email',
        pkce: true,
      });
      expect(JSON.stringify(entry)).not.toContain(CLIENT_SECRET);
      expect(settings.url).toBe(`${issuer.issuer}/oauth/v2/authorize`);
      expect(settings.jwksUri).toBe(`${issuer.issuer}/oauth/v2/keys`);
    });

    it('stays off, without crashing, when the discovery fails', async () => {
      issuer.failDiscovery = true;
      enable();
      await expect(start()).resolves.toBeDefined();
      expect(service.isActive('everid')).toBe(false);
      expect(service.providerEntry('everid')).toBeUndefined();
    });

    it('stays off when a setting is missing', async () => {
      enable({ clientSecret: undefined });
      await start();
      expect(service.isActive('everid')).toBe(false);
      expect(issuer.requests).toHaveLength(0);
    });

    it('stays off for a remote issuer without https', async () => {
      const get = jest.spyOn(http, 'get');
      enable({ issuer: 'http://idp.example.test' });
      await start();
      expect(service.isActive('everid')).toBe(false);
      expect(get).not.toHaveBeenCalled();
    });

    it('refuses an Ever issuer, without any request, unless the install is the Ever-operated cloud', async () => {
      const get = jest.spyOn(http, 'get').mockImplementation(() => {
        throw new Error('no request expected');
      });
      for (const ever of ['https://auth.ever.co', 'https://auth-stage.ever.co/']) {
        enable({ issuer: ever });
        await start();
        expect(service.isActive('everid')).toBe(false);
        // Also as an extra accepted issuer
        enable({ allowedIssuers: [ever] });
        await start();
        expect(service.isActive('everid')).toBe(false);
      }
      expect(get).not.toHaveBeenCalled();

      // On the cloud install the discovery runs (and fails here, as the request is stubbed)
      enable({ issuer: 'https://auth.ever.co', installSource: 'cloud' });
      await start();
      expect(get).toHaveBeenCalledWith('https://auth.ever.co/.well-known/openid-configuration', expect.anything());
    });

    it('keeps an issuer that names itself with a trailing slash', async () => {
      const slashed = new MockOidcIssuer(CLIENT_ID, CLIENT_SECRET, '127.0.0.1', true);
      await slashed.start();
      try {
        expect(slashed.issuer.endsWith('/')).toBe(true);
        enable({ issuer: slashed.issuer });
        await start();
        expect(service.isActive('everid')).toBe(true);
        expect(service.primaryIssuer('everid')).toBe(slashed.issuer);
        const token = await slashed.sign(slashed.idTokenClaims('person-1', { nonce: 'n' }));
        await expect(service.verifyIdToken('everid', token, 'n')).resolves.toMatchObject({ issuer: slashed.issuer });
      } finally {
        await slashed.stop();
      }
    });

    it('requests the standard scopes only from issuers other than Ever ID', () => {
      expect(everIdScope(undefined)).toBe('openid profile email');
      expect(everIdScope(' ')).toBe('openid profile email');
      expect(everIdScope('330011223344550000')).toBe(
        'openid profile email urn:zitadel:iam:user:resourceowner urn:zitadel:iam:org:project:id:330011223344550000:aud',
      );
    });

    it('accepts any other https issuer without the cloud install source', () => {
      expect(isEverHost('https://auth.ever.co')).toBe(true);
      expect(isEverHost('https://ever.co')).toBe(true);
      expect(isEverHost('https://idp.example.test')).toBe(false);
      expect(isEverHost('https://notever.co')).toBe(false);
      expect(isEverHost('https://ever.co.example.test')).toBe(false);
    });
  });

  describe('code exchange', () => {
    it('posts the code and PKCE verifier with the client credentials in a Basic header', async () => {
      enable();
      await start();
      const verifier = 'v'.repeat(43);
      const code = await issuer.authorize({
        redirectUri: REDIRECT_URL,
        nonce: 'n',
        codeChallenge: require('crypto').createHash('sha256').update(verifier).digest('base64url'),
      });
      const tokens = await service.exchangeCode('everid', code, verifier);
      expect(typeof tokens.id_token).toBe('string');
      const request = issuer.requests.find(r => r.path === '/oauth/v2/token');
      const body = new URLSearchParams(request.body);
      expect(Object.fromEntries(body)).toEqual({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URL, code_verifier: verifier });
      expect(request.authorization).toMatch(/^Basic /);
      expect(request.body).not.toContain(CLIENT_SECRET);
    });

    it('fails when the verifier does not match the challenge', async () => {
      enable();
      await start();
      const code = await issuer.authorize({ redirectUri: REDIRECT_URL, nonce: 'n', codeChallenge: 'not-the-challenge' });
      await expect(service.exchangeCode('everid', code, 'v'.repeat(43))).rejects.toMatchObject({ code: 'exchange_failed' });
    });
  });

  describe('ID token verification', () => {
    beforeEach(async () => {
      enable();
      await start();
    });

    const verify = (claims: Record<string, unknown>, nonce = 'the-nonce') =>
      issuer.sign(issuer.idTokenClaims('person-1', { nonce: 'the-nonce', ...claims })).then(token => service.verifyIdToken('everid', token, nonce));

    it('accepts a valid token and returns the identity', async () => {
      const identity = await verify({ 'urn:ever:person_id': 'person-id-1' });
      expect(identity).toMatchObject({
        issuer: issuer.issuer,
        subject: 'person-1',
        email: 'person-1@example.test',
        emailVerified: true,
        name: 'Person person-1',
        sid: 'sid-person-1',
        personId: 'person-id-1',
      });
    });

    it('rejects a token of another issuer', async () => {
      await expect(verify({ iss: 'https://idp.example.test' })).rejects.toMatchObject({ code: 'issuer_rejected' });
    });

    it('rejects a token for another audience', async () => {
      await expect(verify({ aud: 'another-client', azp: 'another-client' })).rejects.toMatchObject({ code: 'audience_rejected' });
    });

    it('rejects a token whose authorized party is another client', async () => {
      await expect(verify({ azp: 'another-client' })).rejects.toMatchObject({ code: 'audience_rejected' });
    });

    it('rejects an expired token', async () => {
      const now = Math.floor(Date.now() / 1000);
      await expect(verify({ iat: now - 1000, exp: now - 600 })).rejects.toMatchObject({ code: 'expired' });
    });

    it('rejects a token with a bad signature', async () => {
      const token = await issuer.sign(issuer.idTokenClaims('person-1', { nonce: 'the-nonce' }));
      const [header, payload, signature] = token.split('.');
      const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), sub: 'person-2' })).toString(
        'base64url',
      );
      await expect(service.verifyIdToken('everid', `${header}.${forged}.${signature}`, 'the-nonce')).rejects.toMatchObject({
        code: 'token_invalid',
      });
    });

    it('rejects an unsigned token', async () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(issuer.idTokenClaims('person-1', { nonce: 'the-nonce' }))).toString('base64url');
      await expect(service.verifyIdToken('everid', `${header}.${payload}.`, 'the-nonce')).rejects.toMatchObject({ code: 'token_invalid' });
    });

    it('rejects a nonce mismatch', async () => {
      await expect(verify({}, 'another-nonce')).rejects.toMatchObject({ code: 'nonce_mismatch' });
      await expect(verify({ nonce: undefined })).rejects.toMatchObject({ code: 'nonce_mismatch' });
    });

    it('rejects an email the issuer did not verify', async () => {
      await expect(verify({ email_verified: false })).rejects.toMatchObject({ code: 'email_unverified' });
      await expect(verify({ email_verified: 'true' })).rejects.toMatchObject({ code: 'email_unverified' });
    });

    it('accepts a token of an extra accepted issuer with that issuer keys', async () => {
      const other = new MockOidcIssuer(CLIENT_ID, CLIENT_SECRET);
      await other.start();
      try {
        enable({ allowedIssuers: [other.issuer] });
        await start();
        const token = await other.sign(other.idTokenClaims('person-9', { nonce: 'n' }));
        await expect(service.verifyIdToken('everid', token, 'n')).resolves.toMatchObject({ issuer: other.issuer, subject: 'person-9' });
        expect(service.primaryIssuer('everid')).toBe(issuer.issuer);
      } finally {
        await other.stop();
      }
    });

    it('parses the documented claim examples; Ever Platform hints are optional', async () => {
      for (const example of (claimExamples as any).examples) {
        const token = await issuer.sign(issuer.idTokenClaims('person-x', { name: undefined, ...example.claims, nonce: 'n' }));
        const identity = await service.verifyIdToken('everid', token, 'n');
        expect(identity.email).toBe(example.expected.email);
        expect(identity.name).toBe(example.expected.name);
        expect(identity.personId).toBe(example.expected.personId);
      }
    });
  });

  describe('key set cache', () => {
    beforeEach(async () => {
      enable();
      await start();
    });

    // Dated on the service's clock, which the tests move
    const at = () => Math.floor(service.clock / 1000);
    const tokenWithKid = (kid: string) =>
      issuer.sign(issuer.idTokenClaims('person-1', { nonce: 'n', iat: at(), exp: at() + 300, auth_time: at() }), { kid });
    const keyRequests = () => requestsTo('/oauth/v2/keys');

    it('reuses the key set for 600 s', async () => {
      await service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n');
      await service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n');
      expect(keyRequests()).toBe(1);
      service.clock += OIDC_JWKS_TTL_MS + 1;
      await expect(service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n')).resolves.toBeDefined();
      expect(keyRequests()).toBe(2);
    });

    it('refetches once for an unknown kid, and not again within 30 s', async () => {
      await service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n');
      expect(keyRequests()).toBe(1);

      // A rotated key is found by one refetch
      await issuer.rotateKey('mock-key-2');
      await expect(service.verifyIdToken('everid', await tokenWithKid('mock-key-2'), 'n')).resolves.toBeDefined();
      expect(keyRequests()).toBe(2);

      // A second unknown kid within the cooldown is rejected without a request
      await expect(service.verifyIdToken('everid', await tokenWithKid('mock-key-3'), 'n')).rejects.toMatchObject({ code: 'token_invalid' });
      expect(keyRequests()).toBe(2);

      // After the cooldown, one more refetch
      service.clock += OIDC_JWKS_REFETCH_COOLDOWN_MS + 1;
      await expect(service.verifyIdToken('everid', await tokenWithKid('mock-key-3'), 'n')).rejects.toMatchObject({ code: 'token_invalid' });
      expect(keyRequests()).toBe(3);
    });

    it('does not wait on an unreachable issuer for every request after a failed refresh', async () => {
      await service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n');
      const get = jest.spyOn(http, 'get').mockImplementation(() => {
        throw new Error('unreachable');
      });
      service.clock += OIDC_JWKS_TTL_MS + 1;
      await service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n');
      await service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n');
      expect(get).toHaveBeenCalledTimes(1);
      service.clock += OIDC_REFRESH_RETRY_MS + 1;
      await service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n');
      expect(get).toHaveBeenCalledTimes(2);
    });

    it('does not ask an unreachable issuer again for 30 s, also without a cached key set', async () => {
      const get = jest.spyOn(http, 'get').mockImplementation(() => {
        throw new Error('unreachable');
      });
      // Discovery is cached since the start; the key set was never fetched
      await expect(service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n')).rejects.toMatchObject({ code: 'jwks_unavailable' });
      await expect(service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n')).rejects.toMatchObject({ code: 'jwks_unavailable' });
      expect(get).toHaveBeenCalledTimes(1);
      get.mockRestore();
      service.clock += OIDC_REFRESH_RETRY_MS + 1;
      await expect(service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n')).resolves.toBeDefined();
    });

    it('keeps using a key set up to 6 h old when the issuer cannot be reached', async () => {
      const token = await tokenWithKid(issuer.kid);
      await service.verifyIdToken('everid', token, 'n');
      jest.spyOn(http, 'get').mockImplementation(() => {
        throw new Error('unreachable');
      });
      service.clock += OIDC_JWKS_TTL_MS + 1;
      await expect(service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n')).resolves.toBeDefined();
      service.clock += OIDC_JWKS_MAX_STALE_MS;
      await expect(service.verifyIdToken('everid', await tokenWithKid(issuer.kid), 'n')).rejects.toMatchObject({ code: 'jwks_unavailable' });
    });
  });

  describe('logout token verification', () => {
    beforeEach(async () => {
      enable();
      await start();
    });

    it('accepts a valid logout token', async () => {
      const token = await issuer.logoutToken({ sid: 'sid-1', sub: 'person-1', jti: 'jti-1' });
      await expect(service.verifyLogoutToken('everid', token)).resolves.toMatchObject({ issuer: issuer.issuer, sid: 'sid-1', jti: 'jti-1' });
    });

    it('rejects a logout token older than 300 s', async () => {
      const token = await issuer.logoutToken({ sid: 'sid-1' }, 301);
      await expect(service.verifyLogoutToken('everid', token)).rejects.toMatchObject({ code: 'expired' });
    });

    it('rejects a logout token without the back-channel event, with a nonce, without jti, or for another client', async () => {
      await expect(service.verifyLogoutToken('everid', await issuer.logoutToken({ sid: 's' }, 0, { events: {} }))).rejects.toMatchObject({
        code: 'token_invalid',
      });
      await expect(service.verifyLogoutToken('everid', await issuer.logoutToken({ sid: 's' }, 0, { nonce: 'n' }))).rejects.toMatchObject({
        code: 'token_invalid',
      });
      await expect(service.verifyLogoutToken('everid', await issuer.logoutToken({ sid: 's' }, 0, { jti: undefined }))).rejects.toMatchObject({
        code: 'token_invalid',
      });
      await expect(service.verifyLogoutToken('everid', await issuer.logoutToken({ sid: 's' }, 0, { aud: 'another' }))).rejects.toMatchObject({
        code: 'audience_rejected',
      });
      await expect(
        service.verifyLogoutToken('everid', await issuer.logoutToken({}, 0, { events: { [BACKCHANNEL_LOGOUT_EVENT]: {} } })),
      ).rejects.toMatchObject({ code: 'token_invalid' });
    });
  });
});
