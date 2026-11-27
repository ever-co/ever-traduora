import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { SaasModeService } from '../services/saas-mode.service';
import { GetOrganizations, OrganizationsState } from '../stores/organizations.state';

/** The organization pages exist only in SaaS mode; a self-hosted install goes to its project list. */
export const saasGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  return inject(SaasModeService).saas$.pipe(map(saas => (saas ? true : router.parseUrl('/projects'))));
};

/**
 * In SaaS mode, `/projects` is the current organization's list (`/orgs/<slug>/projects`), or the page to create one for
 * a person who has none. A self-hosted install keeps its project list.
 */
export const projectsRedirectGuard: CanActivateFn = (): Observable<boolean | UrlTree> => {
  const router = inject(Router);
  const store = inject(Store);
  return inject(SaasModeService).saas$.pipe(
    switchMap(saas => {
      if (!saas) {
        return of(true);
      }
      return store.dispatch(new GetOrganizations()).pipe(
        map(() => {
          const current = store.selectSnapshot(OrganizationsState.currentOrganization);
          return router.parseUrl(current ? `/orgs/${current.slug}/projects` : '/orgs/new');
        }),
        // Without the list, the plain project list still works
        catchError(() => of(true)),
      );
    }),
  );
};
