import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { AuthService, PENDING_AUTHORIZATION_KEY } from '../../services/auth.service';
import { ProviderSignInFailed, ReceiveAuthProviderCode, ReceiveIdentityConnectCode } from '../../stores/auth.state';
import { AuthCallbackComponent } from './callback.component';

describe('AuthCallbackComponent', () => {
  let dispatch: jasmine.Spy;
  let queryParams: { [key: string]: string } = {};

  const everid = {
    slug: 'everid',
    url: 'https://idp.example.test/oauth/v2/authorize',
    redirectUrl: 'http://localhost:8080/auth/callback',
    clientId: 'everid-client',
    scope: 'openid profile email',
    pkce: true,
  };

  const createWith = (params: { [key: string]: string }) => {
    queryParams = params;
    const fixture = TestBed.createComponent(AuthCallbackComponent);
    fixture.detectChanges();
    return fixture;
  };

  /** Starts an authorization request as the sign-in button does, and returns its state. */
  const startAuthorization = async (intent: 'signin' | 'connect') => {
    const url = await TestBed.inject(AuthService).oidcAuthorizeUrl(everid, intent);
    return new URL(url).searchParams.get('state');
  };

  beforeEach(() => {
    dispatch = jasmine.createSpy('dispatch');
    TestBed.configureTestingModule({
      declarations: [AuthCallbackComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: Store, useValue: { dispatch } },
        { provide: Router, useValue: { navigate: jasmine.createSpy('navigate') } },
        {
          provide: ActivatedRoute,
          useValue: {
            get queryParams() {
              return of(queryParams);
            },
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    sessionStorage.removeItem(PENDING_AUTHORIZATION_KEY);
  });

  afterEach(() => sessionStorage.removeItem(PENDING_AUTHORIZATION_KEY));

  it('sends a Google callback code alone, as before', () => {
    createWith({ code: 'google-code', scope: 'email profile openid' });
    expect(dispatch).toHaveBeenCalledOnceWith(new ReceiveAuthProviderCode('google-code'));
    const action = dispatch.calls.mostRecent().args[0] as ReceiveAuthProviderCode;
    expect(action.oidc).toBeUndefined();
  });

  it('sends an Ever ID callback with the provider from the state, its nonce and PKCE verifier', async () => {
    const state = await startAuthorization('signin');
    const pending = JSON.parse(sessionStorage.getItem(PENDING_AUTHORIZATION_KEY));
    createWith({ code: 'everid-code', state });

    const action = dispatch.calls.mostRecent().args[0] as ReceiveAuthProviderCode;
    expect(action).toEqual(jasmine.any(ReceiveAuthProviderCode));
    expect(action.code).toBe('everid-code');
    expect(action.oidc).toEqual({ provider: 'everid', state, nonce: pending.nonce, code_verifier: pending.codeVerifier });
    // Used once
    expect(sessionStorage.getItem(PENDING_AUTHORIZATION_KEY)).toBeNull();
  });

  it('continues a connect from the settings', async () => {
    const state = await startAuthorization('connect');
    createWith({ code: 'connect-code', state });
    const action = dispatch.calls.mostRecent().args[0] as ReceiveIdentityConnectCode;
    expect(action).toEqual(jasmine.any(ReceiveIdentityConnectCode));
    expect(action.payload.code).toBe('connect-code');
    expect(action.payload.provider).toBe('everid');
  });

  it('refuses a callback whose state this browser did not start', async () => {
    await startAuthorization('signin');
    const foreignState = btoa(JSON.stringify({ p: 'everid', n: 'someone-else' })).replace(/=+$/, '');
    createWith({ code: 'everid-code', state: foreignState });
    expect(dispatch).toHaveBeenCalledOnceWith(jasmine.any(ProviderSignInFailed));
  });
});
