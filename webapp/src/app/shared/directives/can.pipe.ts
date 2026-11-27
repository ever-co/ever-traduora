import { Pipe, PipeTransform } from '@angular/core';
import { Store } from '@ngxs/store';
import { combineLatest, Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { $enum } from 'ts-enum-util';
import { ProjectUserState } from '../../projects/stores/project-user.state';
import { ProjectsState } from '../../projects/stores/projects.state';
import { ProjectRole } from '../../projects/models/project-role';
import { isAuthorized, ProjectAction } from '../models/actions';

/**
 * The role the signed-in person acts with in the current project: the project's `role` as the API answers it, which is
 * the effective one (an organization owner or admin is an implicit project admin where the organization allows it), or
 * else their row in the project's member list.
 */
export function currentProjectRole(store: Store): Observable<ProjectRole | undefined> {
  return combineLatest([store.select(ProjectsState.currentProject), store.select(ProjectUserState.userSelf)]).pipe(
    map(([project, self]) => (project?.role as ProjectRole | undefined) ?? self?.role),
  );
}

@Pipe({
  standalone: false,
  name: 'can',
})
export class CanPipe implements PipeTransform {
  role$: Observable<ProjectRole | undefined>;

  constructor(private store: Store) {
    this.role$ = currentProjectRole(this.store);
  }

  transform(conditional: any, action: string): Observable<boolean> {
    return this.role$.pipe(
      map(role => {
        if (!conditional) {
          return false;
        }
        try {
          const parsedAction = $enum(ProjectAction).getValueOrThrow(action);
          return isAuthorized(role, parsedAction);
        } catch {
          return false;
        }
      }),
    );
  }
}
