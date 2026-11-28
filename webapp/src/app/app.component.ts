import { Component, inject } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { combineLatest, Observable } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { AuthState } from './auth/stores/auth.state';
import { ProjectClientState } from './projects/stores/project-client.state';
import { ProjectUserState } from './projects/stores/project-user.state';
import { ProjectsState } from './projects/stores/projects.state';
import { TermsState } from './projects/stores/terms.state';
import { TranslationsState } from './projects/stores/translations.state';

@Component({
  standalone: false,
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  @Select(AuthState.isAuthenticated)
  isAuthenticated$: Observable<boolean>;

  @Select(AuthState.isLoading)
  authLoading$!: Observable<boolean>;

  @Select(TermsState.isLoading)
  termLoading$!: Observable<boolean>;

  @Select(ProjectsState.isLoading)
  projectLoading$!: Observable<boolean>;

  @Select(TranslationsState.isLoading)
  translationLoading$!: Observable<boolean>;

  @Select(ProjectUserState.isLoading)
  projectUserLoading$!: Observable<boolean>;

  @Select(ProjectClientState.isLoading)
  projectClientLoading$!: Observable<boolean>;

  /** The app bar, for a signed-in account that is not pending (an e-mail to confirm, terms to accept: SaaS mode) */
  private readonly store = inject(Store);

  showBar$ = combineLatest([this.store.select(AuthState.isAuthenticated), this.store.select(AuthState.user)]).pipe(
    // Only once the profile is loaded and not pending (`pending` of GET /users/me is null), so a pending account never sees it
    map(([authenticated, user]) => authenticated && user?.pending === null),
  );

  isLoading$ = combineLatest([
    this.authLoading$,
    this.termLoading$,
    this.projectLoading$,
    this.translationLoading$,
    this.projectUserLoading$,
    this.projectClientLoading$,
  ]).pipe(
    map(([authLoading, termLoading, projectLoading, translationLoading, projectUserLoading, projectClientLoading]) => {
      return authLoading || termLoading || projectLoading || translationLoading || projectUserLoading || projectClientLoading;
    }),
    delay(0), // Required to avoid change within render lifecycle
  );
}
