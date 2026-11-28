import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, defer, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, map, shareReplay, startWith, switchMap, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { InstallationSettings } from '../../auth/models/account-settings';

/** The answer of `GET /auth/providers` as it stands: still loading, loaded, or failed (a retry asks again). */
export type SettingsState = { status: 'loading' } | { status: 'loaded'; settings: InstallationSettings } | { status: 'failed' };

const parse = (res: Partial<InstallationSettings> | null): InstallationSettings => ({
  saas: res?.saas === true,
  turnstileSiteKey: typeof res?.turnstileSiteKey === 'string' && res.turnstileSiteKey ? res.turnstileSiteKey : undefined,
  legal: res?.legal?.terms?.version && res?.legal?.privacy?.version ? res.legal : undefined,
});

/**
 * Whether the installation runs in SaaS mode (`saas` of `GET /auth/providers`). Organizations are shown only then: a
 * self-hosted install has one organization that everyone is in, and shows none. The same answer carries the Turnstile
 * site key and, in SaaS mode, the legal documents of a sign-up.
 *
 * Asked once per page load. A failed request stays a failure (`state$`), apart from a single-tenant answer: forms that
 * need the settings wait for them and offer `reload()`, which updates every subscriber; a later subscriber asks again
 * too. `saas$` reads a failure as single-tenant meanwhile.
 */
@Injectable({ providedIn: 'root' })
export class SaasModeService {
  readonly state$: Observable<SettingsState>;
  /** The settings, once loaded */
  readonly settings$: Observable<InstallationSettings>;
  readonly saas$: Observable<boolean>;

  private readonly reloads = new BehaviorSubject<void>(undefined);
  private last: SettingsState = { status: 'loading' };

  constructor(http: HttpClient) {
    const shared$ = this.reloads.pipe(
      switchMap(() =>
        http.get<Partial<InstallationSettings>>(`${environment.apiEndpoint}/auth/providers`).pipe(
          map(res => ({ status: 'loaded', settings: parse(res) }) as SettingsState),
          catchError(() => of({ status: 'failed' } as SettingsState)),
          startWith({ status: 'loading' } as SettingsState),
        ),
      ),
      tap(state => (this.last = state)),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.state$ = defer(() => {
      if (this.last.status === 'failed') {
        this.reload();
      }
      return shared$;
    });
    this.settings$ = this.state$.pipe(
      filter((state): state is { status: 'loaded'; settings: InstallationSettings } => state.status === 'loaded'),
      map(state => state.settings),
    );
    this.saas$ = this.state$.pipe(
      filter(state => state.status !== 'loading'),
      map(state => state.status === 'loaded' && state.settings.saas),
      distinctUntilChanged(),
    );
  }

  /** Asks the API again, e.g. after a failure; every subscriber gets the new answer. */
  reload(): void {
    this.reloads.next();
  }
}
