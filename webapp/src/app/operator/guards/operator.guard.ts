import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthState } from '../../auth/stores/auth.state';
import { OperatorService } from '../services/operator.service';

/**
 * The operator pages are for the installation's operators only: anyone else gets the not-found page, as the API answers
 * them. Signed out, it asks nothing (AuthGuard sends to the sign-in), so no 401 ends a session that is not there.
 */
export const operatorGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  if (!inject(Store).selectSnapshot(AuthState.isAuthenticated)) {
    return of(false);
  }
  const router = inject(Router);
  return inject(OperatorService)
    .isOperator()
    .pipe(map(operator => (operator ? true : router.parseUrl('/404'))));
};
