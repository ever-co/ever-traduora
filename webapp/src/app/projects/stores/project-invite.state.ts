import { Action, NgxsOnInit, Selector, State, StateContext, Store } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Logout } from '../../auth/stores/auth.state';
import { errorToMessage } from '../../shared/util/api-error';
import { ProjectRole } from '../models/project-role';
import { ClearCurrentProject, ProjectsState, SetCurrentProject } from './projects.state';
import { GetProjectUsers } from './project-user.state';
import { ProjectInvite, ProjectInviteAddedUser } from '../models/project-invite';
import { ProjectInviteService } from '../services/project-invite.service';
import { Injectable } from '@angular/core';

export class ClearMessages {
  static readonly type = '[ProjectInvite] Clear messages';
}

export class GetProjectInvites {
  static readonly type = '[ProjectInvite] Get project invites';
  constructor(public projectId: string) {}
}

export class AddProjectInvite {
  static readonly type = '[ProjectInvite] Add project invite';
  constructor(
    public projectId: string,
    public email: string,
    public role: ProjectRole,
  ) {}
}

export class UpdateProjectInvite {
  static readonly type = '[ProjectInvite] Update project invite';
  constructor(
    public projectId: string,
    public inviteId: string,
    public role: ProjectRole,
  ) {}
}

export class RemoveProjectInvite {
  static readonly type = '[ProjectInvite] Remove project invite';
  constructor(
    public projectId: string,
    public inviteId: string,
  ) {}
}

export interface ProjectInviteStateModel {
  invites: ProjectInvite[];
  // Result of the last AddProjectInvite: a pending invite with its link, or a user added directly
  lastAdded: ProjectInvite | ProjectInviteAddedUser | undefined;
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults = {
  invites: [],
  lastAdded: undefined,
  isLoading: false,
  errorMessage: undefined,
};

@State<ProjectInviteStateModel>({
  name: 'projectInvites',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class ProjectInviteState implements NgxsOnInit {
  constructor(
    private projectInviteService: ProjectInviteService,
    private store: Store,
  ) {}

  @Selector()
  static isLoading(state: ProjectInviteStateModel) {
    return state.isLoading;
  }

  @Selector()
  static invites(state: ProjectInviteStateModel) {
    return state.invites;
  }

  @Selector()
  static lastAdded(state: ProjectInviteStateModel) {
    return state.lastAdded;
  }

  ngxsOnInit(_ctx: StateContext<ProjectInviteStateModel>) {
    // Intentionally left empty
    // TODO: Implement initialization logic if needed
  }

  @Action(Logout)
  logout(ctx: StateContext<ProjectInviteStateModel>, action: Logout) {
    ctx.setState(stateDefaults);
  }

  @Action(GetProjectInvites)
  getProjectInvites(ctx: StateContext<ProjectInviteStateModel>, action: GetProjectInvites) {
    ctx.patchState({ isLoading: true });
    return this.projectInviteService.find(action.projectId).pipe(
      tap(invites => ctx.patchState({ invites })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(AddProjectInvite)
  addProjectInvite(ctx: StateContext<ProjectInviteStateModel>, action: AddProjectInvite) {
    ctx.patchState({ isLoading: true, lastAdded: undefined });
    return this.projectInviteService.create(action.projectId, action.email, action.role).pipe(
      tap(added => {
        ctx.patchState({ lastAdded: added });
        // The lists belong to the open project, which may have changed while this was sending
        if (this.store.selectSnapshot(ProjectsState.currentProject)?.id !== action.projectId) {
          return;
        }
        const invites = ctx.getState().invites;
        if ('userId' in added) {
          // A member now, and the API removed any invite sent to them before they had an account
          ctx.patchState({ lastAdded: added, invites: invites.filter(i => i.email !== added.email) });
          ctx.dispatch(new GetProjectUsers(action.projectId));
        } else {
          // A new link replaces the listed invite of a re-invited email
          ctx.patchState({ lastAdded: added, invites: [added, ...invites.filter(i => i.id !== added.id)] });
        }
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error, 'AddProjectInvite') });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateProjectInvite)
  updateProjectInvite(ctx: StateContext<ProjectInviteStateModel>, action: UpdateProjectInvite) {
    ctx.patchState({ isLoading: true });
    return this.projectInviteService.update(action.projectId, action.inviteId, action.role).pipe(
      tap(updatedInvite => {
        const invites = ctx.getState().invites.map(invite => {
          if (invite.id === updatedInvite.id) {
            return updatedInvite;
          } else {
            return invite;
          }
        });
        ctx.patchState({ invites });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(RemoveProjectInvite)
  removeProjectInvite(ctx: StateContext<ProjectInviteStateModel>, action: RemoveProjectInvite) {
    ctx.patchState({ isLoading: true });
    return this.projectInviteService.remove(action.projectId, action.inviteId).pipe(
      tap(() => {
        const invites = ctx.getState().invites.filter(invite => invite.id !== action.inviteId);
        ctx.patchState({ invites });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<ProjectInviteStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }

  @Action(ClearCurrentProject)
  clearCurrentProject(ctx: StateContext<ProjectInviteStateModel>) {
    ctx.patchState(stateDefaults);
  }
}
