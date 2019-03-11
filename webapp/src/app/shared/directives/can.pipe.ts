import { Pipe, PipeTransform } from '@angular/core';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { $enum } from 'ts-enum-util';
import { ProjectUser } from '../../projects/models/project-user';
import { ProjectUserState } from '../../projects/stores/project-user.state';
import { isAuthorized, ProjectAction } from '../models/actions';

@Pipe({ name: 'can' })
export class CanPipe implements PipeTransform {
  user$: Observable<ProjectUser>;

  constructor(private store: Store) {
    this.user$ = this.store.select(ProjectUserState.userSelf);
  }

  transform(conditional: any, action: string): Observable<Boolean> {
    return this.user$.pipe(
      map(user => {
        if (!conditional) {
          return false;
        }
        try {
          const parsedAction = $enum(ProjectAction).getValueOrThrow(action);
          return isAuthorized(user.role, parsedAction);
        } catch {
          return false;
        }
      }),
    );
  }
}
