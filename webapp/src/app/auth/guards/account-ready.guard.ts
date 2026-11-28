import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { isPendingAccountStep, PENDING_STEP_PAGES } from '../models/account-settings';
import { localReturnPath } from '../models/identity';
import { AuthService } from '../services/auth.service';
import { AuthState, SetUserInfo } from '../stores/auth.state';

/**
 * Sends a signed-in person whose account is still pending (SaaS mode: e-mail to confirm, terms to accept) to the page
 * that finishes it, with the way back, before the page they asked for loads and meets 403s. Asks the API each time
 * (`pending` of `GET /users/me`), so a link confirmed in another tab counts at once. A failed answer lets the page
 * load: the API still refuses what a pending account may not do, and the error interceptor routes the same way.
 */
export const accountReadyGuard: CanActivateFn = (_route, state) => {
  const store = inject(Store);
  const router = inject(Router);
  if (!store.selectSnapshot(AuthState.isAuthenticated)) {
    // AuthGuard sends the person to sign in
    return true;
  }
  return inject(AuthService)
    .getUserSelf()
    .pipe(
      map(user => {
        if (!isPendingAccountStep(user?.pending)) {
          return true;
        }
        // The app bar and the switcher hide for a pending account: they read the stored profile
        store.dispatch(new SetUserInfo(user));
        const returnTo = localReturnPath(state.url);
        return router.createUrlTree([PENDING_STEP_PAGES[user.pending]], returnTo ? { queryParams: { returnTo } } : {});
      }),
      catchError(() => of(true)),
    );
};
