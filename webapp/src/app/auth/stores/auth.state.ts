import { Navigate } from '@ngxs/router-plugin';
import { Action, NgxsOnInit, Selector, State, StateContext } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, map, tap } from 'rxjs/operators';
import { errorToMessage } from '../../shared/util/api-error';
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
  constructor(public name: string, public email: string, public password: string) {}
}

export class UpdateUserSelf {
  static readonly type = '[Auth] Update user self';
  constructor(public updates: { name?: string; email?: string }) {}
}

export class Login {
  static readonly type = '[Auth] Login';
  constructor(public email: string, public password: string) {}
}

export class ReceiveAuthProviderCode {
  static readonly type = '[Auth] Receive provider auth code';
  constructor(public code: string) {}
}

export class ReceiveAPIAccessToken {
  static readonly type = '[Auth] Receive API access token';
  constructor(public payload: { accessToken: string }) {}
}

export class RedirectToAuthProvider {
  static readonly type = '[Auth] Redirect to auth provider sign in';
  constructor(public provider: Provider) {}
}

export class ForgotPassword {
  static readonly type = '[Auth] Forgot password';
  constructor(public email: string) {}
}

export class ResetPassword {
  static readonly type = '[Auth] Reset password';
  constructor(public email: string, public newPassword: string, public token: string) {}
}

export class ChangePassword {
  static readonly type = '[Auth] Change password';
  constructor(public oldPassword: string, public newPassword: string) {}
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
  constructor(public type: string, public error: any) {}
}

export interface AuthStateModel {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | undefined;
  statusMessage: string | undefined;
  errorMessage: string | undefined;
  redirectTo: string | undefined;
  providers: Provider[] | undefined;
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
  },
})
@Injectable({ providedIn: 'root' })
export class AuthState implements NgxsOnInit {
  constructor(private authService: AuthService, private tokenService: TokenService) {}

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
        ctx.patchState({
          user: user,
          errorMessage: undefined,
          statusMessage: 'Successfully updated your information.',
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
        ctx.dispatch(new AuthError('login', error));
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ReceiveAuthProviderCode)
  receiveProviderAuthCode(ctx: StateContext<AuthStateModel>, action: ReceiveAuthProviderCode) {
    ctx.patchState({ isLoading: true });
    return this.authService.signInWithProvider(action).pipe(
      tap(token => ctx.dispatch(new ReceiveAPIAccessToken(token))),
      catchError(error => {
        ctx.dispatch(new AuthError('login', error));
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
    ctx.dispatch(new Navigate([redirect || '/']));
  }

  @Action(RedirectToAuthProvider)
  redirectToAuthProvider(ctx: StateContext<AuthStateModel>, action: RedirectToAuthProvider) {
    return this.authService.redirectWithProvider(action.provider);
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
    ctx.patchState({ user: undefined, isAuthenticated: false, errorMessage: action.reason });
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
