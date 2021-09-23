import { Action, NgxsOnInit, Selector, State, StateContext, Store } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, mergeMap, map, take, tap } from 'rxjs/operators';
import { AuthState, Logout } from '../../auth/stores/auth.state';
import { errorToMessage } from '../../shared/util/api-error';
import { ProjectRole } from '../models/project-role';
import { ProjectUser } from '../models/project-user';
import { ProjectUserService } from '../services/project-user.service';
import { ClearCurrentProject, SetCurrentProject } from './projects.state';
import { Injectable } from '@angular/core';

export class ClearMessages {
  static readonly type = '[ProjectUser] Clear messages';
}

export class GetProjectUsers {
  static readonly type = '[ProjectUser] Get project users';
  constructor(public projectId: string) {}
}

export class UpdateProjectUser {
  static readonly type = '[ProjectUser] Update project user';
  constructor(public projectId: string, public userId: string, public role: ProjectRole) {}
}

export class RemoveProjectUser {
  static readonly type = '[ProjectUser] Remove project user';
  constructor(public projectId: string, public userId: string) {}
}

export interface ProjectUserStateModel {
  users: ProjectUser[];
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults = {
  users: [],
  isLoading: false,
  errorMessage: undefined,
};

@State<ProjectUserStateModel>({
  name: 'projectUsers',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class ProjectUserState implements NgxsOnInit {
  constructor(private projectUserService: ProjectUserService, private store: Store) {}

  @Selector()
  static userSelf(state: ProjectUserStateModel) {
    return state.users.find(u => !!u.isSelf);
  }

  @Selector()
  static isLoading(state: ProjectUserStateModel) {
    return state.isLoading;
  }

  @Selector()
  static users(state: ProjectUserStateModel) {
    return state.users;
  }

  ngxsOnInit(ctx: StateContext<ProjectUserStateModel>) {}

  @Action(SetCurrentProject)
  setCurrentProject(ctx: StateContext<ProjectUserStateModel>, action: SetCurrentProject) {
    // Whenever the current project changes, retrieve the project users to know which role the current user has
    ctx.dispatch(new GetProjectUsers(action.id));
  }

  @Action(Logout)
  logout(ctx: StateContext<ProjectUserStateModel>, action: Logout) {
    ctx.setState(stateDefaults);
  }

  @Action(GetProjectUsers)
  getProjectUsers(ctx: StateContext<ProjectUserStateModel>, action: GetProjectUsers) {
    ctx.patchState({ isLoading: true });
    return this.projectUserService.find(action.projectId).pipe(
      mergeMap(users => {
        const currentUser = this.store.select(AuthState.user);
        return currentUser.pipe(
          take(1),
          map(user => {
            return users.map(u => {
              if (u.userId === user.id) {
                u.isSelf = true;
              }
              return u;
            });
          }),
        );
      }),
      tap(users => ctx.patchState({ users })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateProjectUser)
  updateProjectUser(ctx: StateContext<ProjectUserStateModel>, action: UpdateProjectUser) {
    ctx.patchState({ isLoading: true });
    return this.projectUserService.update(action.projectId, action.userId, action.role).pipe(
      tap(updatedUser => {
        const users = ctx.getState().users.map(u => {
          if (u.userId === updatedUser.userId) {
            return updatedUser;
          } else {
            return u;
          }
        });
        ctx.patchState({ users });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(RemoveProjectUser)
  removeProjectUser(ctx: StateContext<ProjectUserStateModel>, action: RemoveProjectUser) {
    ctx.patchState({ isLoading: true });
    return this.projectUserService.remove(action.projectId, action.userId).pipe(
      tap(() => {
        const users = ctx.getState().users.filter(u => u.userId !== action.userId);
        ctx.patchState({ users });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<ProjectUserStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }

  @Action(ClearCurrentProject)
  clearCurrentProject(ctx: StateContext<ProjectUserStateModel>) {
    ctx.patchState(stateDefaults);
  }
}
