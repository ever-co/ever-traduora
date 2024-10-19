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
export class NoAuthGuard  {
  constructor(private store: Store) {}

  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    return this.store.selectOnce(AuthState.isAuthenticated).pipe(
      map(isAuthenticated => {
        if (isAuthenticated) {
          this.store.dispatch(new Navigate(['/']));
          return false;
        }
        return true;
      }),
    );
  }
}
