import { Component } from '@angular/core';
import { Select } from '@ngxs/store';
import { combineLatest, Observable } from 'rxjs';
import { delay, map } from 'rxjs/operators';
import { AuthState } from './auth/stores/auth.state';
import { ProjectClientState } from './projects/stores/project-client.state';
import { ProjectUserState } from './projects/stores/project-user.state';
import { ProjectsState } from './projects/stores/projects.state';
import { TermsState } from './projects/stores/terms.state';
import { TranslationsState } from './projects/stores/translations.state';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent {
  @Select(AuthState.isAuthenticated)
  isAuthenticated$: Observable<boolean>;

  @Select(AuthState.isLoading)
  authLoading$: Observable<boolean>;

  @Select(TermsState.isLoading)
  termLoading$: Observable<boolean>;

  @Select(ProjectsState.isLoading)
  projectLoading$: Observable<boolean>;

  @Select(TranslationsState.isLoading)
  translationLoading$: Observable<boolean>;

  @Select(ProjectUserState.isLoading)
  projectUserLoading$: Observable<boolean>;

  @Select(ProjectClientState.isLoading)
  projectClientLoading$: Observable<boolean>;

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

  constructor() {}
}
