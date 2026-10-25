import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Navigate } from '@ngxs/router-plugin';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthState } from '../stores/auth.state';

@Injectable({
  providedIn: 'root',
})
export class NoAuthGuard {
  constructor(private store: Store) {}

  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    return this.store.selectOnce(AuthState.isAuthenticated).pipe(
      map(isAuthenticated => {
        if (isAuthenticated) {
          // Signed-in people opening an invitation link accept it with their account
          const invite = next.queryParamMap.get('invite');
          this.store.dispatch(invite ? new Navigate(['/accept-invite'], { invite }) : new Navigate(['/']));
          return false;
        }
        return true;
      }),
    );
  }
}
