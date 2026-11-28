import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, shareReplay } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { InstallationSettings } from '../../auth/models/account-settings';

/**
 * Whether the installation runs in SaaS mode (`saas` of `GET /auth/providers`). Organizations are shown only then: a
 * self-hosted install has one organization that everyone is in, and shows none. Asked once per page load, again after a
 * failed request. The same answer carries the Turnstile site key and, in SaaS mode, the legal documents of a sign-up.
 */
@Injectable({ providedIn: 'root' })
export class SaasModeService {
  readonly settings$: Observable<InstallationSettings>;
  readonly saas$: Observable<boolean>;

  constructor(http: HttpClient) {
    // An answer is kept for the page's life; a failed request is not (the next subscriber asks again), and reads as
    // single-tenant without Turnstile or terms meanwhile
    const answer$ = http.get<Partial<InstallationSettings>>(`${environment.apiEndpoint}/auth/providers`).pipe(
      map(res => ({
        saas: res?.saas === true,
        turnstileSiteKey: typeof res?.turnstileSiteKey === 'string' && res.turnstileSiteKey ? res.turnstileSiteKey : undefined,
        legal: res?.legal?.terms?.version && res?.legal?.privacy?.version ? res.legal : undefined,
      })),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.settings$ = answer$.pipe(catchError(() => of({ saas: false } as InstallationSettings)));
    this.saas$ = this.settings$.pipe(map(settings => settings.saas));
  }
}
