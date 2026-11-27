import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/**
 * Whether the installation runs in SaaS mode (`saas` of `GET /auth/providers`). Organizations are shown only then: a
 * self-hosted install has one organization that everyone is in, and shows none. Asked once per page load.
 */
@Injectable({ providedIn: 'root' })
export class SaasModeService {
  readonly saas$: Observable<boolean>;

  constructor(http: HttpClient) {
    this.saas$ = http.get<{ saas?: boolean }>(`${environment.apiEndpoint}/auth/providers`).pipe(
      map(res => res?.saas === true),
      catchError(() => of(false)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
  }
}
