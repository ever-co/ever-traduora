import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { get } from 'lodash';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { isPendingAccountStep, PENDING_STEP_PAGES } from '../models/account-settings';
import { localReturnPath } from '../models/identity';
import { GetUserInfo, Logout } from '../stores/auth.state';

/** Pages a pending account is not sent back to once it is ready: sign-in, sign-up and the pending steps themselves */
const NO_RETURN_PAGES = /^\/(signup|login|forgot-password|reset-password|auth\/|check-inbox|accept-terms)/;

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  constructor(
    private store: Store,
    private injector: Injector,
  ) {}

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(request).pipe(
      catchError(err => {
        if (err instanceof HttpErrorResponse && err.status === 401 && !this.whitelisted(request)) {
          this.store.dispatch(new Logout('Your session has expired, please signin to continue.'));
        }
        if (err instanceof HttpErrorResponse && err.status === 403) {
          this.finishPendingAccount(get(err, 'error.error.code'));
        }
        return throwError(err);
      }),
    );
  }

  /**
   * SaaS mode: an account that is still pending (e-mail to confirm, terms to accept) is sent to the page that finishes
   * it, with the way back, e.g. when new terms come into force during a session.
   */
  private finishPendingAccount(code: unknown): void {
    if (!isPendingAccountStep(code)) {
      return;
    }
    // The stored profile becomes pending too, so the app bar and the switcher hide (new terms during a session)
    this.store.dispatch(new GetUserInfo());
    // Looked up when needed: the router depends on HttpClient through the lazy routes, and so on this interceptor
    const router = this.injector.get(Router);
    const page = PENDING_STEP_PAGES[code];
    if (router.url.split('?')[0] === page) {
      return;
    }
    // Back to where the person was, unless that was a sign-in page (a sign-up that just finished, say)
    const returnTo = localReturnPath(router.url);
    const worthReturning = returnTo && returnTo !== '/' && !NO_RETURN_PAGES.test(returnTo);
    void router.navigate([page], worthReturning ? { queryParams: { returnTo } } : {});
  }

  private whitelisted(request: HttpRequest<any>): boolean {
    if (request.url.includes('change-password')) {
      return true;
    }
    // A 401 here means the invite token is missing or invalid, not that a session expired
    if (request.url.endsWith('/auth/signup')) {
      return true;
    }
    // The public provisioning routes: a 401 there means the link from app.ever.co does not verify
    if (/\/ever-connect\/provision\/(intent|intents\/[^/]+\/reject)$/.test(request.url)) {
      return true;
    }
    return false;
  }
}
