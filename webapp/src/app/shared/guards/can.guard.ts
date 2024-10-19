import { Injectable } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ProjectUser } from '../../projects/models/project-user';
import { ProjectUserState } from '../../projects/stores/project-user.state';

@Injectable({
  providedIn: 'root',
})
export class CanGuard  {
  user$: Observable<ProjectUser>;

  constructor(private store: Store) {
    this.user$ = this.store.select(ProjectUserState.userSelf);
  }

  canActivate(next: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> | Promise<boolean> | boolean {
    const roles = (next.data['roles'] || []) as Array<string>;
    return this.user$.pipe(map(user => (user && user.role && roles.findIndex(r => r === user.role) >= 0) || false));
  }
}
