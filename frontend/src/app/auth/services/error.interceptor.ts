import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { Logout } from '../stores/auth.state';

@Injectable()
export class ErrorInterceptor implements HttpInterceptor {
  constructor(private store: Store) {}

  intercept(request: HttpRequest<any>, next: HttpHandler): Observable<HttpEvent<any>> {
    return next.handle(request).pipe(
      catchError(err => {
        if (err instanceof HttpErrorResponse && err.status === 401 && !this.whitelisted(request)) {
          this.store.dispatch(new Logout('Your session has expired, please signin to continue.'));
        }
        return throwError(err);
      }),
    );
  }

  private whitelisted(request: HttpRequest<any>): boolean {
    if (request.url.includes('change-password')) {
      return true;
    }
    return false;
  }
}
