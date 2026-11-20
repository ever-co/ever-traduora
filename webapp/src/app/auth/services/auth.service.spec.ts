import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Provider } from '../models/provider';
import { AuthService, PENDING_AUTHORIZATION_KEY, pkceChallenge, providerOfState } from './auth.service';

describe('AuthService provider redirects', () => {
  let service: AuthService;

  const google: Provider = {
    slug: 'google',
    url: 'https://accounts.google.com/o/oauth2/v2/auth',
    redirectUrl: 'http://localhost:8080/auth/callback',
    clientId: 'google-client',
  };

  const everid: Provider = {
    slug: 'everid',
    url: 'https://idp.example.test/oauth/v2/authorize',
    redirectUrl: 'http://localhost:8080/auth/callback',
    clientId: 'everid-client',
    scope: 'openid profile email urn:zitadel:iam:user:resourceowner',
    pkce: true,
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(AuthService);
    sessionStorage.removeItem(PENDING_AUTHORIZATION_KEY);
  });

  afterEach(() => sessionStorage.removeItem(PENDING_AUTHORIZATION_KEY));

  it('keeps the Google authorization request exactly as before', () => {
    const open = spyOn(window, 'open');
    service.redirectWithProvider(google);
    expect(open).toHaveBeenCalledOnceWith(
      'https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=http://localhost:8080/auth/callback&client_id=google-client' +
        '&scope=email profile openid&access_type=offline&prompt=select_account&response_type=code',
      '_self',
    );
    expect(sessionStorage.getItem(PENDING_AUTHORIZATION_KEY)).toBeNull();
  });

  it('sends state, nonce and a PKCE S256 challenge to Ever ID, and nothing Google-specific', async () => {
    const url = new URL(await service.oidcAuthorizeUrl(everid, 'signin'));
    const params = url.searchParams;
    const pending = JSON.parse(sessionStorage.getItem(PENDING_AUTHORIZATION_KEY));

    expect(`${url.origin}${url.pathname}`).toBe(everid.url);
    expect(params.get('response_type')).toBe('code');
    expect(params.get('client_id')).toBe('everid-client');
    expect(params.get('redirect_uri')).toBe('http://localhost:8080/auth/callback');
    expect(params.get('scope')).toBe(everid.scope);
    expect(params.get('state')).toBe(pending.state);
    expect(params.get('nonce')).toBe(pending.nonce);
    expect(params.get('code_challenge_method')).toBe('S256');
    expect(params.get('code_challenge')).toBe(await pkceChallenge(pending.codeVerifier));
    expect(pending.codeVerifier.length).toBeGreaterThanOrEqual(43);
    expect(params.has('code_verifier')).toBeFalse();
    expect(params.has('access_type')).toBeFalse();
    expect(params.has('prompt')).toBeFalse();
    expect(params.has('login_hint')).toBeFalse();
    expect(url.toString()).not.toContain('@');
    expect(providerOfState(params.get('state'))).toBe('everid');
    expect(pending.intent).toBe('signin');
  });

  it('asks for a fresh sign-in when connecting Ever ID from the settings', async () => {
    const params = new URL(await service.oidcAuthorizeUrl(everid, 'connect')).searchParams;
    expect(params.get('prompt')).toBe('login');
    expect(params.get('max_age')).toBe('300');
    expect(JSON.parse(sessionStorage.getItem(PENDING_AUTHORIZATION_KEY)).intent).toBe('connect');
  });

  it('redirects to the Ever ID authorization request', async () => {
    const open = spyOn(window, 'open');
    await service.redirectWithProvider(everid);
    const [target, frame] = open.calls.mostRecent().args;
    expect(String(target)).toContain('https://idp.example.test/oauth/v2/authorize?');
    expect(String(target)).toContain('code_challenge_method=S256');
    expect(frame).toBe('_self');
  });

  it('gives the pending request to the callback of the same state only, once', async () => {
    const state = new URL(await service.oidcAuthorizeUrl(everid, 'signin')).searchParams.get('state');
    expect(service.peekPendingAuthorization('another-state')).toBeUndefined();
    expect(service.peekPendingAuthorization(state)?.provider).toBe('everid');
    expect(service.takePendingAuthorization(state)?.provider).toBe('everid');
    expect(service.takePendingAuthorization(state)).toBeUndefined();
  });

  it('ignores a pending request older than 10 minutes', async () => {
    const state = new URL(await service.oidcAuthorizeUrl(everid, 'signin')).searchParams.get('state');
    const pending = JSON.parse(sessionStorage.getItem(PENDING_AUTHORIZATION_KEY));
    sessionStorage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify({ ...pending, createdAt: Date.now() - 11 * 60 * 1000 }));
    expect(service.takePendingAuthorization(state)).toBeUndefined();
  });

  it('reads the provider of a state, and none from a Google callback', () => {
    expect(providerOfState(undefined)).toBeUndefined();
    expect(providerOfState('not-a-state')).toBeUndefined();
    expect(providerOfState(btoa(JSON.stringify({ p: 'everid', n: 'x' })).replace(/=+$/, ''))).toBe('everid');
  });
});
