import { Navigate } from '@ngxs/router-plugin';
import { Action, NgxsOnInit, Selector, State, StateContext } from '@ngxs/store';
import { get } from 'lodash';
import { EMPTY, throwError } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import { errorToMessage } from '../../shared/util/api-error';
import { Identity, IdentityConnection, ProviderSignupConfirmation } from '../models/identity';
import { Provider } from '../models/provider';
import { User } from '../models/user';
import { AuthService } from '../services/auth.service';
import { TokenService } from '../services/token.service';
import { Injectable } from '@angular/core';

export class GetUserInfo {
  static readonly type = '[Auth] Get user info';
}

export class CheckAuth {
  static readonly type = '[Auth] Check auth';
}

export class DeleteAccount {
  static readonly type = '[Auth] Delete Account';
}

export class GetProviders {
  static readonly type = '[Auth] Get providers';
}

export class Signup {
  static readonly type = '[Auth] Signup';
  constructor(
    public name: string,
    public email: string,
    public password: string,
    public inviteToken?: string,
  ) {}
}

export class UpdateUserSelf {
  static readonly type = '[Auth] Update user self';
  constructor(public updates: { name?: string; email?: string }) {}
}

export class Login {
  static readonly type = '[Auth] Login';
  constructor(
    public email: string,
    public password: string,
  ) {}
}

export class ReceiveAuthProviderCode {
  static readonly type = '[Auth] Receive provider auth code';
  // `oidc` only for OpenID Connect providers (e.g. Ever ID); a Google callback sends the code alone
  constructor(
    public code: string,
    public oidc?: { provider: string; state: string; nonce: string; code_verifier: string },
  ) {}
}

export class ReceiveAPIAccessToken {
  static readonly type = '[Auth] Receive API access token';
  constructor(public payload: { accessToken: string }) {}
}

export class RedirectToAuthProvider {
  static readonly type = '[Auth] Redirect to auth provider sign in';
  constructor(
    public provider: Provider,
    public options: { intent?: 'signin' | 'connect' } = {},
  ) {}
}

export class ConfirmProviderSignup {
  static readonly type = '[Auth] Confirm provider signup';
  constructor(public acceptInvites: string[]) {}
}

export class CancelProviderSignup {
  static readonly type = '[Auth] Cancel provider signup';
}

export class ReceiveIdentityConnectCode {
  static readonly type = '[Auth] Receive identity connect code';
  constructor(public payload: { code: string; provider: string; state: string; nonce: string; code_verifier: string }) {}
}

export class ConfirmIdentityConnect {
  static readonly type = '[Auth] Confirm identity connect';
}

export class CancelIdentityConnect {
  static readonly type = '[Auth] Cancel identity connect';
}

export class GetIdentities {
  static readonly type = '[Auth] Get identities';
}

export class DeleteIdentity {
  static readonly type = '[Auth] Delete identity';
  constructor(public id: string) {}
}

export class ProviderSignInFailed {
  static readonly type = '[Auth] Provider sign in failed';
  constructor(public message: string) {}
}

/** Shown when an Ever ID sign-in finds an account with the same email that it is not connected to. */
export const ACCOUNT_EXISTS_MESSAGE =
  'An account with this email already exists. Sign in the usual way, then connect Ever ID in your account settings (Connected sign-in methods).';

export class ForgotPassword {
  static readonly type = '[Auth] Forgot password';
  constructor(public email: string) {}
}

export class ResetPassword {
  static readonly type = '[Auth] Reset password';
  constructor(
    public email: string,
    public newPassword: string,
    public token: string,
  ) {}
}

export class ChangePassword {
  static readonly type = '[Auth] Change password';
  constructor(
    public oldPassword: string,
    public newPassword: string,
  ) {}
}

export class ClearMessages {
  static readonly type = '[Auth] Clear messages';
}

export class Logout {
  static readonly type = '[Auth] Logout';
  constructor(public reason: string | undefined = null) {}
}

export class MustLogin {
  static readonly type = '[Auth] Must login with redirect';
  constructor(public redirectTo: string) {}
}

export class AuthError {
  static readonly type = '[Auth] Auth Error';
  constructor(
    public type: string,
    public error: any,
  ) {}
}

export interface AuthStateModel {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | undefined;
  statusMessage: string | undefined;
  errorMessage: string | undefined;
  redirectTo: string | undefined;
  providers: Provider[] | undefined;
  // Ever ID (OpenID Connect) sign-in: the sign-up waiting for its confirmation screen, a connection waiting for the
  // person to confirm both emails, and the connected identities. In memory only.
  pendingSignup?: ProviderSignupConfirmation;
  pendingConnect?: IdentityConnection;
  identities?: Identity[];
}

@State<AuthStateModel>({
  name: 'auth',
  defaults: {
    isAuthenticated: false,
    isLoading: false,
    user: undefined,
    statusMessage: undefined,
    errorMessage: undefined,
    redirectTo: undefined,
    providers: undefined,
    pendingSignup: undefined,
    pendingConnect: undefined,
    identities: undefined,
  },
})
@Injectable({ providedIn: 'root' })
export class AuthState implements NgxsOnInit {
  constructor(
    private authService: AuthService,
    private tokenService: TokenService,
  ) {}

  @Selector()
  static isLoading(state: AuthStateModel) {
    return state.isLoading;
  }

  @Selector()
  static statusMessage(state: AuthStateModel) {
    return state.statusMessage;
  }

  @Selector()
  static isAuthenticated(state: AuthStateModel) {
    return state.isAuthenticated;
  }

  @Selector()
  static user(state: AuthStateModel) {
    return state.user;
  }

  @Selector()
  static pendingSignup(state: AuthStateModel) {
    return state.pendingSignup;
  }

  @Selector()
  static pendingConnect(state: AuthStateModel) {
    return state.pendingConnect;
  }

  @Selector()
  static identities(state: AuthStateModel) {
    return state.identities;
  }

  ngxsOnInit(ctx: StateContext<AuthStateModel>) {
    ctx.dispatch(new CheckAuth());
  }

  @Action(CheckAuth)
  checkAuth(ctx: StateContext<AuthStateModel>) {
    const token = this.tokenService.getToken();
    if (!token) {
      return ctx.patchState({ isAuthenticated: false });
    }
    const ok = this.tokenService.isTokenValid();
    if (ok) {
      ctx.patchState({ isAuthenticated: true });
      ctx.dispatch(new GetUserInfo());
    } else {
      ctx.dispatch(new Logout('Please sign in to continue'));
    }
  }

  @Action(GetUserInfo)
  getUserInfo(ctx: StateContext<AuthStateModel>) {
    return this.authService.getUserSelf().pipe(
      tap(user => {
        ctx.patchState({ user: user, isAuthenticated: true });
      }),
    );
  }

  @Action(GetProviders)
  getProviders(ctx: StateContext<AuthStateModel>) {
    return this.authService.getProviders().pipe(
      tap(providers => {
        ctx.patchState({ providers });
      }),
    );
  }

  @Action(Signup)
  signup(ctx: StateContext<AuthStateModel>, action: Signup) {
    ctx.patchState({ isLoading: true });
    return this.authService.signup(action).pipe(
      map(user => {
        ctx.patchState({ user });
        ctx.dispatch(new ReceiveAPIAccessToken(user));
      }),
      catchError(error => {
        ctx.dispatch(new AuthError('Signup', error));
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(DeleteAccount)
  deleteAccount(ctx: StateContext<AuthStateModel>, action: DeleteAccount) {
    ctx.patchState({ isLoading: true });
    return this.authService.deleteAccount().pipe(
      map(user => {
        ctx.dispatch(new Logout('Your account has been permanently deleted.'));
      }),
      catchError(error => {
        ctx.dispatch(new AuthError('DeleteAccount', error));
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateUserSelf)
  updateUserSelf(ctx: StateContext<AuthStateModel>, action: UpdateUserSelf) {
    ctx.patchState({ isLoading: true });
    return this.authService.updateUserSelf(action.updates).pipe(
      map(user => {
        const emailChanged = ctx.getState().user?.email !== user.email;
        ctx.patchState({
          user: user,
          errorMessage: undefined,
          statusMessage: emailChanged
            ? 'Successfully updated your information. Please confirm your new email with the link we sent to it.'
            : 'Successfully updated your information.',
        });
      }),
      catchError(error => {
        ctx.dispatch(new AuthError('UpdateUserSelf', error));
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(Login)
  login(ctx: StateContext<AuthStateModel>, action: Login) {
    ctx.patchState({ isLoading: true });
    return this.authService.login(action).pipe(
      tap(token => ctx.dispatch(new ReceiveAPIAccessToken(token))),
      catchError(error => {
        ctx.dispatch(new AuthError('Login', error));
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ReceiveAuthProviderCode)
  receiveProviderAuthCode(ctx: StateContext<AuthStateModel>, action: ReceiveAuthProviderCode) {
    ctx.patchState({ isLoading: true });
    const request = action.oidc ? { code: action.code, ...action.oidc } : action;
    return this.authService.signInWithProvider(request).pipe(
      tap(token => ctx.dispatch(new ReceiveAPIAccessToken(token))),
      catchError(error => {
        if (action.oidc) {
          return this.onOidcSignInError(ctx, error);
        }
        ctx.dispatch(new AuthError('Login', error));
        return throwError(error);
      }),
      finalize(() => {
        ctx.patchState({ isLoading: false });
      }),
    );
  }

  @Action(ReceiveAPIAccessToken)
  receiveAPIAccessToken(ctx: StateContext<AuthStateModel>, { payload }: ReceiveAPIAccessToken) {
    this.tokenService.setToken(payload.accessToken);
    ctx.patchState({ isAuthenticated: true });
    ctx.dispatch(new GetUserInfo());
    const redirect = ctx.getState().redirectTo;
    if (redirect) {
      ctx.patchState({ redirectTo: undefined });
    }
    // The redirect is a URL: keep its query (e.g. an invitation link's token) out of the path
    const [path, query] = (redirect || '/').split('?');
    const queryParams: { [key: string]: string } = {};
    new URLSearchParams(query).forEach((value, key) => (queryParams[key] = value));
    ctx.dispatch(new Navigate([path], queryParams));
  }

  @Action(RedirectToAuthProvider)
  redirectToAuthProvider(ctx: StateContext<AuthStateModel>, action: RedirectToAuthProvider) {
    const redirect = this.authService.redirectWithProvider(action.provider, action.options);
    // An OpenID Connect request (e.g. Ever ID) is built asynchronously and needs a secure context (https)
    return redirect instanceof Promise
      ? redirect.catch(() =>
          ctx.patchState({ errorMessage: 'Sign-in with Ever ID could not start. It needs a secure (https) connection to Traduora.' }),
        )
      : redirect;
  }

  /**
   * An Ever ID sign-in that did not sign in: a new account waits for the confirmation screen, an account with the
   * same email is never signed in to (sign in the usual way, then connect), anything else shows its message.
   */
  private onOidcSignInError(ctx: StateContext<AuthStateModel>, error: any) {
    const code = get(error, 'error.error.code');
    if (error?.status === 409 && code === 'signup_confirmation_required') {
      const details = get(error, 'error.error.details') as ProviderSignupConfirmation;
      ctx.patchState({ pendingSignup: details, errorMessage: undefined });
      ctx.dispatch(new Navigate(['/auth/everid/confirm']));
      return EMPTY;
    }
    if (error?.status === 409 && code === 'account_exists') {
      return ctx.dispatch(new ProviderSignInFailed(ACCOUNT_EXISTS_MESSAGE));
    }
    return ctx.dispatch(new ProviderSignInFailed(errorToMessage(error, 'ProviderSignIn')));
  }

  @Action(ProviderSignInFailed)
  providerSignInFailed(ctx: StateContext<AuthStateModel>, action: ProviderSignInFailed) {
    ctx.patchState({ errorMessage: action.message, pendingSignup: undefined });
    ctx.dispatch(new Navigate(['/login']));
  }

  @Action(ConfirmProviderSignup)
  confirmProviderSignup(ctx: StateContext<AuthStateModel>, action: ConfirmProviderSignup) {
    const pending = ctx.getState().pendingSignup;
    if (!pending) {
      return ctx.dispatch(new ProviderSignInFailed('This sign-up expired. Please sign in with Ever ID again.'));
    }
    ctx.patchState({ isLoading: true });
    return this.authService.confirmProviderSignup(pending.pending, action.acceptInvites).pipe(
      tap(user => {
        ctx.patchState({ pendingSignup: undefined });
        ctx.dispatch(new ReceiveAPIAccessToken(user));
      }),
      catchError(error => {
        const code = get(error, 'error.error.code');
        const message = error?.status === 409 && code === 'account_exists' ? ACCOUNT_EXISTS_MESSAGE : errorToMessage(error, 'ProviderSignIn');
        return ctx.dispatch(new ProviderSignInFailed(message));
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(CancelProviderSignup)
  cancelProviderSignup(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({ pendingSignup: undefined, errorMessage: undefined });
    ctx.dispatch(new Navigate(['/login']));
  }

  @Action(ReceiveIdentityConnectCode)
  receiveIdentityConnectCode(ctx: StateContext<AuthStateModel>, action: ReceiveIdentityConnectCode) {
    ctx.patchState({ isLoading: true, pendingConnect: undefined });
    return this.authService.connectIdentity(action.payload).pipe(
      tap(connection => {
        ctx.patchState({ pendingConnect: connection, errorMessage: undefined, statusMessage: undefined });
        ctx.dispatch(new Navigate(['/user-settings']));
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error, 'ConnectIdentity'), statusMessage: undefined });
        ctx.dispatch(new Navigate(['/user-settings']));
        return EMPTY;
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ConfirmIdentityConnect)
  confirmIdentityConnect(ctx: StateContext<AuthStateModel>) {
    const pending = ctx.getState().pendingConnect;
    if (!pending) {
      return;
    }
    ctx.patchState({ isLoading: true });
    return this.authService.confirmConnectIdentity(pending.pending).pipe(
      tap(() => {
        ctx.patchState({ pendingConnect: undefined, errorMessage: undefined, statusMessage: 'Ever ID is connected: you can now sign in with it.' });
        ctx.dispatch(new GetIdentities());
      }),
      catchError(error => {
        ctx.patchState({ pendingConnect: undefined, errorMessage: errorToMessage(error, 'ConnectIdentity'), statusMessage: undefined });
        return EMPTY;
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(CancelIdentityConnect)
  cancelIdentityConnect(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({ pendingConnect: undefined });
  }

  @Action(GetIdentities)
  getIdentities(ctx: StateContext<AuthStateModel>) {
    return this.authService.listIdentities().pipe(
      tap(identities => ctx.patchState({ identities })),
      catchError(() => {
        ctx.patchState({ identities: undefined });
        return EMPTY;
      }),
    );
  }

  @Action(DeleteIdentity)
  deleteIdentity(ctx: StateContext<AuthStateModel>, action: DeleteIdentity) {
    ctx.patchState({ isLoading: true });
    return this.authService.deleteIdentity(action.id).pipe(
      tap(() => {
        ctx.patchState({ errorMessage: undefined, statusMessage: 'Ever ID is disconnected.' });
        ctx.dispatch(new GetIdentities());
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error, 'DeleteIdentity'), statusMessage: undefined });
        return EMPTY;
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ForgotPassword)
  forgotPassword(ctx: StateContext<AuthStateModel>, action: ForgotPassword) {
    ctx.patchState({ isLoading: true });
    return this.authService.forgotPassword(action.email).pipe(
      tap(() => {
        const statusMessage =
          'A password reset token has been sent to your email. ' +
          // tslint:disable-next-line:quotemark
          "If you didn't get an email after a few minutes, try requesting another one.";
        ctx.patchState({ errorMessage: undefined, statusMessage });
      }),
      catchError(error => {
        ctx.dispatch(new AuthError('ForgotPassword', error));
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ChangePassword)
  changePassword(ctx: StateContext<AuthStateModel>, action: ChangePassword) {
    ctx.patchState({ isLoading: true });
    return this.authService.changePassword(action).pipe(
      tap(() => {
        ctx.patchState({ errorMessage: undefined, statusMessage: 'Password successfully changed!' });
      }),
      catchError(error => {
        ctx.dispatch(new AuthError('ChangePassword', error));
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ResetPassword)
  resetPassword(ctx: StateContext<AuthStateModel>, action: ResetPassword) {
    ctx.patchState({ isLoading: true });
    return this.authService.resetPassword(action).pipe(
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error, 'ResetPassword') });
        return throwError(error);
      }),
      tap(() => {
        const statusMessage = 'Your password has been successfully reset. Please login with your new password.';
        ctx.patchState({ statusMessage, errorMessage: undefined });
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(MustLogin)
  mustLogin(ctx: StateContext<AuthStateModel>, action: MustLogin) {
    ctx.patchState({ redirectTo: action.redirectTo, errorMessage: 'Please sign in to continue' });
    ctx.dispatch(new Navigate(['/login']));
  }

  @Action(Logout)
  logout(ctx: StateContext<AuthStateModel>, action: Logout) {
    this.tokenService.clearToken();
    ctx.patchState({ user: undefined, isAuthenticated: false, errorMessage: action.reason, pendingConnect: undefined, identities: undefined });
    ctx.dispatch(new Navigate(['/login']));
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<AuthStateModel>) {
    ctx.patchState({ errorMessage: undefined, statusMessage: undefined });
  }

  @Action(AuthError)
  onError(ctx: StateContext<AuthStateModel>, action: AuthError) {
    ctx.patchState({ errorMessage: errorToMessage(action.error, action.type) });
    return throwError(action.error);
  }
}
