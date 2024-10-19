import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { AuthState, MustLogin } from '../stores/auth.state';

@Injectable({
  providedIn: 'root',
})
export class AuthGuard  {
  constructor(private store: Store) {}

  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    return this.store.selectOnce(AuthState.isAuthenticated).pipe(
      map(ok => {
        if (!ok) {
          this.store.dispatch(new MustLogin(state.url));
        }
        return true;
      }),
    );
  }
}
