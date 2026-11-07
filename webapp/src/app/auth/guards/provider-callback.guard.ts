import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Observable } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { NoAuthGuard } from './no-auth.guard';

/**
 * Guards the provider callback route. Like NoAuthGuard, except for the callback of a connect from the account
 * settings (an Ever ID connected to the signed-in account), which this browser started and which needs the session.
 */
@Injectable({
  providedIn: 'root',
})
export class ProviderCallbackGuard {
  constructor(
    private readonly authService: AuthService,
    private readonly noAuthGuard: NoAuthGuard,
  ) {}

  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    const pending = this.authService.peekPendingAuthorization(next.queryParamMap.get('state'));
    if (pending?.intent === 'connect') {
      return true;
    }
    return this.noAuthGuard.canActivate(next, state);
  }
}
