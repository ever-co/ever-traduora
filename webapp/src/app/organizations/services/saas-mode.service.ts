import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/**
 * Whether the installation runs in SaaS mode (`saas` of `GET /auth/providers`). Organizations are shown only then: a
 * self-hosted install has one organization that everyone is in, and shows none. Asked once per page load, again after a
 * failed request.
 */
@Injectable({ providedIn: 'root' })
export class SaasModeService {
  readonly saas$: Observable<boolean>;

  constructor(http: HttpClient) {
    // An answer is kept for the page's life; a failed request is not (the next subscriber asks again), and reads as
    // single-tenant meanwhile
    const answer$ = http.get<{ saas?: boolean }>(`${environment.apiEndpoint}/auth/providers`).pipe(
      map(res => res?.saas === true),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.saas$ = answer$.pipe(catchError(() => of(false)));
  }
}
