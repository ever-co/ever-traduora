import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { Identity, IdentityConnection, PendingAuthorization } from '../models/identity';
import { Provider } from '../models/provider';
import { User } from '../models/user';
import { UserLogin } from '../models/user-login';
import { UserSignup, UserSignupWithProvider } from '../models/user-signup';
import { environment } from './../../../environments/environment';

/** Session storage key of the pending OpenID Connect authorization request (read once by the callback). */
export const PENDING_AUTHORIZATION_KEY = 'tr.oidc.pending';

/** A pending authorization request older than this is ignored, milliseconds. */
const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

/** Random bytes as base64url text (RFC 4648, section 5), without padding. */
export function randomBase64Url(size = 32): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(size)));
}

/** The PKCE S256 challenge of a verifier: base64url(SHA-256(verifier)) (RFC 7636, section 4.2). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/** The provider an OpenID Connect `state` was created for, or undefined (e.g. Google callbacks carry no state). */
export function providerOfState(state: string | undefined): string | undefined {
  if (!state) {
    return undefined;
  }
  try {
    const decoded = JSON.parse(atob(state.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof decoded?.p === 'string' ? decoded.p : undefined;
  } catch {
    return undefined;
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach(byte => (binary += String.fromCharCode(byte)));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  acceptInvite(inviteToken: string): Observable<{ projectId: string; role: string }> {
    return this.http
      .post<Payload<{ projectId: string; role: string }>>(`${this.endpoint}/auth/accept-invite`, { inviteToken })
      .pipe(map(res => res.data));
  }

  verifyEmail(token: string): Observable<{ email: string; emailVerified: boolean }> {
    return this.http
      .post<Payload<{ email: string; emailVerified: boolean }>>(`${this.endpoint}/auth/verify-email`, { token })
      .pipe(map(res => res.data));
  }

  resendVerificationEmail(): Observable<any> {
    return this.http.post(`${this.endpoint}/auth/resend-verification-email`, {}, { responseType: 'text' });
  }

  getUserSelf(): Observable<User> {
    return this.http.get<Payload<User>>(`${this.endpoint}/users/me`).pipe(map(res => res.data));
  }

  updateUserSelf(updates: { name?: string; email?: string }): Observable<User> {
    return this.http.patch<Payload<User>>(`${this.endpoint}/users/me`, updates).pipe(map(res => res.data));
  }

  getProviders(): Observable<Provider[]> {
    return this.http.get<Payload<Provider[]>>(`${this.endpoint}/auth/providers`).pipe(map(res => res.data));
  }

  signup(data: UserSignup): Observable<{ accessToken: string } & User> {
    return this.http.post<Payload<{ accessToken: string } & User>>(`${this.endpoint}/auth/signup`, data).pipe(map(res => res.data));
  }

  // Signing in with a provider is an idempotent operation
  signInWithProvider(data: UserSignupWithProvider): Observable<{ accessToken: string } & User> {
    return this.http.post<Payload<{ accessToken: string } & User>>(`${this.endpoint}/auth/signup-provider`, data).pipe(map(res => res.data));
  }

  /** Creates the account of a sign-in with an OpenID Connect provider (e.g. Ever ID) after the person confirmed it. */
  confirmProviderSignup(pending: string, acceptInvites: string[]): Observable<{ accessToken: string } & User> {
    return this.http
      .post<Payload<{ accessToken: string } & User>>(`${this.endpoint}/auth/everid/signup-confirm`, { pending, acceptInvites })
      .pipe(map(res => res.data));
  }

  connectIdentity(data: { code: string; provider: string; state: string; nonce: string; code_verifier: string }): Observable<IdentityConnection> {
    return this.http.post<Payload<IdentityConnection>>(`${this.endpoint}/auth/identities/connect`, data).pipe(map(res => res.data));
  }

  confirmConnectIdentity(pending: string): Observable<Identity> {
    return this.http.post<Payload<Identity>>(`${this.endpoint}/auth/identities/connect/confirm`, { pending }).pipe(map(res => res.data));
  }

  listIdentities(): Observable<Identity[]> {
    return this.http.get<Payload<Identity[]>>(`${this.endpoint}/auth/identities`).pipe(map(res => res.data));
  }

  deleteIdentity(id: string): Observable<any> {
    return this.http.delete(`${this.endpoint}/auth/identities/${encodeURIComponent(id)}`, { responseType: 'text' });
  }

  login(data: UserLogin): Observable<{ accessToken: string }> {
    return this.http
      .post<{ access_token: string; expires_in: string; token_type: string }>(`${this.endpoint}/auth/token`, {
        username: data.email,
        password: data.password,
        grant_type: 'password',
      })
      .pipe(map(res => ({ accessToken: res.access_token })));
  }

  redirectWithProvider(provider: Provider, options: { intent?: 'signin' | 'connect' } = {}): void | Promise<void> {
    // OpenID Connect providers (e.g. Ever ID): state, nonce and PKCE. Google keeps its request as it was.
    if (provider.pkce) {
      return this.redirectWithOidcProvider(provider, options.intent ?? 'signin');
    }
    window.open(
      `${provider.url}?redirect_uri=${provider.redirectUrl}&client_id=${provider.clientId}&scope=email profile openid&access_type=offline&prompt=select_account&response_type=code`, // tslint:disable-line max-line-length
      '_self',
    );
  }

  /** Builds the authorization request of an OpenID Connect provider (state, nonce, PKCE S256). */
  async oidcAuthorizeUrl(provider: Provider, intent: 'signin' | 'connect'): Promise<string> {
    const pending: PendingAuthorization = {
      provider: provider.slug,
      state: btoa(JSON.stringify({ p: provider.slug, n: randomBase64Url(16) }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, ''),
      nonce: randomBase64Url(32),
      codeVerifier: randomBase64Url(32),
      intent,
      createdAt: Date.now(),
    };
    sessionStorage.setItem(PENDING_AUTHORIZATION_KEY, JSON.stringify(pending));

    const url = new URL(provider.url);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', provider.clientId);
    url.searchParams.set('redirect_uri', provider.redirectUrl);
    url.searchParams.set('scope', provider.scope || 'openid profile email');
    url.searchParams.set('state', pending.state);
    url.searchParams.set('nonce', pending.nonce);
    url.searchParams.set('code_challenge', await pkceChallenge(pending.codeVerifier));
    url.searchParams.set('code_challenge_method', 'S256');
    if (intent === 'connect') {
      // Connecting needs a fresh sign-in at the provider
      url.searchParams.set('prompt', 'login');
      url.searchParams.set('max_age', '300');
    }
    return url.toString();
  }

  private async redirectWithOidcProvider(provider: Provider, intent: 'signin' | 'connect'): Promise<void> {
    window.open(await this.oidcAuthorizeUrl(provider, intent), '_self');
  }

  /** The pending authorization request a callback's `state` belongs to, if any, without removing it. */
  peekPendingAuthorization(state: string | undefined | null): PendingAuthorization | undefined {
    if (!state) {
      return undefined;
    }
    try {
      const pending = JSON.parse(sessionStorage.getItem(PENDING_AUTHORIZATION_KEY) || 'null') as PendingAuthorization | null;
      if (!pending || pending.state !== state || Date.now() - pending.createdAt > PENDING_AUTHORIZATION_TTL_MS) {
        return undefined;
      }
      return pending;
    } catch {
      return undefined;
    }
  }

  /** Like peekPendingAuthorization, and removes it: a pending authorization request is used once. */
  takePendingAuthorization(state: string | undefined | null): PendingAuthorization | undefined {
    const pending = this.peekPendingAuthorization(state);
    sessionStorage.removeItem(PENDING_AUTHORIZATION_KEY);
    return pending;
  }

  deleteAccount(): Observable<any> {
    return this.http.delete<any>(`${this.endpoint}/users/me`);
  }

  forgotPassword(email: string): Observable<any> {
    return this.http.post(`${this.endpoint}/auth/forgot-password`, { email: email }, { responseType: 'text' });
  }

  resetPassword(data: { email: string; newPassword: string; token: string }): Observable<any> {
    return this.http.post(`${this.endpoint}/auth/reset-password`, data, { responseType: 'text' });
  }

  changePassword(data: { oldPassword: string; newPassword: string }): Observable<any> {
    return this.http.post(`${this.endpoint}/auth/change-password`, data, { responseType: 'text' });
  }
}
