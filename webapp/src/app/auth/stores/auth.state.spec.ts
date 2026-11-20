import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Navigate } from '@ngxs/router-plugin';
import { Actions, NgxsModule, ofActionDispatched, Store } from '@ngxs/store';
import { environment } from '../../../environments/environment';
import { AuthService } from '../services/auth.service';
import {
  ACCOUNT_EXISTS_MESSAGE,
  AuthError,
  AuthState,
  ConfirmProviderSignup,
  ReceiveAPIAccessToken,
  ReceiveAuthProviderCode,
  RedirectToAuthProvider,
} from './auth.state';

describe('AuthState provider sign-in', () => {
  let store: Store;
  let http: HttpTestingController;
  let dispatched: any[];

  const endpoint = environment.apiEndpoint;
  const oidc = { provider: 'everid', state: 'state', nonce: 'nonce', code_verifier: 'v'.repeat(43) };

  beforeEach(() => {
    localStorage.removeItem('accessToken');
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([AuthState])],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
    dispatched = [];
    const actions = TestBed.inject(Actions);
    actions.pipe(ofActionDispatched(Navigate, AuthError, ReceiveAPIAccessToken)).subscribe(action => dispatched.push(action));
  });

  // A sign-in stores its token; never leave one for other tests
  afterEach(() => localStorage.removeItem('accessToken'));

  it('posts a Google code alone, as before', () => {
    store.dispatch(new ReceiveAuthProviderCode('google-code')).subscribe({ error: () => undefined });
    const req = http.expectOne(`${endpoint}/auth/signup-provider`);
    expect(req.request.body).toEqual(new ReceiveAuthProviderCode('google-code'));
    expect(JSON.parse(JSON.stringify(req.request.body))).toEqual({ code: 'google-code' });
    req.flush({ data: { accessToken: 'token' } });
  });

  it('posts an Ever ID code with its provider, state, nonce and PKCE verifier', () => {
    store.dispatch(new ReceiveAuthProviderCode('everid-code', oidc));
    const req = http.expectOne(`${endpoint}/auth/signup-provider`);
    expect(req.request.body).toEqual({ code: 'everid-code', ...oidc });
    req.flush({ data: { accessToken: 'token' } });
  });

  it('opens the confirmation screen when a new account needs confirming, and creates nothing', () => {
    store.dispatch(new ReceiveAuthProviderCode('everid-code', oidc));
    const details = { pending: 'v1.sealed', name: 'New Person', email: 'new@example.test', invites: [{ id: 'i1', projectName: 'Docs' }] };
    http
      .expectOne(`${endpoint}/auth/signup-provider`)
      .flush({ error: { code: 'signup_confirmation_required', message: 'Confirm', details } }, { status: 409, statusText: 'Conflict' });

    expect(store.selectSnapshot(AuthState.pendingSignup)).toEqual(details);
    expect(dispatched).toEqual([new Navigate(['/auth/everid/confirm'])]);
  });

  it('asks to sign in the usual way when an account has the same email', () => {
    store.dispatch(new ReceiveAuthProviderCode('everid-code', oidc));
    http
      .expectOne(`${endpoint}/auth/signup-provider`)
      .flush({ error: { code: 'account_exists', message: 'exists' } }, { status: 409, statusText: 'Conflict' });

    expect(store.selectSnapshot(state => state.auth.errorMessage)).toBe(ACCOUNT_EXISTS_MESSAGE);
    expect(dispatched).toEqual([new Navigate(['/login'])]);
    expect(store.selectSnapshot(state => state.auth.isAuthenticated)).toBeFalse();
  });

  it('shows a message when the Ever ID request cannot be built (no secure context)', async () => {
    const authService = TestBed.inject(AuthService);
    spyOn(authService, 'redirectWithProvider').and.returnValue(Promise.reject(new TypeError('crypto.subtle is undefined')));
    const provider = { slug: 'everid', url: 'https://idp.example.test/authorize', redirectUrl: 'r', clientId: 'c', pkce: true };
    await store.dispatch(new RedirectToAuthProvider(provider)).toPromise();
    expect(store.selectSnapshot(state => state.auth.errorMessage)).toContain('secure (https) connection');
  });

  it('creates the confirmed account with only the ticked invitations', () => {
    store.reset({
      ...store.snapshot(),
      auth: { ...store.snapshot().auth, pendingSignup: { pending: 'v1.sealed', name: 'N', email: 'e', invites: [] } },
    });
    store.dispatch(new ConfirmProviderSignup(['i2']));
    const req = http.expectOne(`${endpoint}/auth/everid/signup-confirm`);
    expect(req.request.body).toEqual({ pending: 'v1.sealed', acceptInvites: ['i2'] });
    req.flush({ data: { id: 'u1', name: 'N', email: 'e', accessToken: 'token' } });
    expect(store.selectSnapshot(AuthState.pendingSignup)).toBeUndefined();
    expect(dispatched.some(action => action instanceof ReceiveAPIAccessToken)).toBeTrue();
  });
});
