import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { ProjectsState } from '../../projects/stores/projects.state';

/**
 * Lets a project page open for the roles in its route `data.roles`, by the role the person acts with in that project
 * (the effective one the API answers with the project, see `currentProjectRole`), once that project is loaded.
 */
@Injectable({
  providedIn: 'root',
})
export class CanGuard {
  constructor(private store: Store) {}

  canActivate(next: ActivatedRouteSnapshot): Observable<boolean> {
    const roles = (next.data['roles'] || []) as Array<string>;
    const projectId = next.paramMap.get('projectId') ?? next.parent?.paramMap.get('projectId');
    return this.store.select(ProjectsState.currentProject).pipe(
      filter(project => !!project && (!projectId || project.id === projectId)),
      take(1),
      map(project => !!project.role && roles.includes(project.role)),
    );
  }
}
