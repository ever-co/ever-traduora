import { Action, NgxsOnInit, Selector, State, StateContext, Store } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Logout } from '../../auth/stores/auth.state';
import { errorToMessage } from '../../shared/util/api-error';
import { ProjectClient } from '../models/project-client';
import { ProjectRole } from '../models/project-role';
import { ProjectClientService } from '../services/project-client.service';
import { ClearCurrentProject } from './projects.state';
import { Injectable } from '@angular/core';

export class ClearMessages {
  static readonly type = '[ProjectClient] Clear messages';
}

export class GetProjectClients {
  static readonly type = '[ProjectClient] Get project clients';
  constructor(public projectId: string) {}
}

export class AddProjectClient {
  static readonly type = '[ProjectClient] Add project client';
  constructor(public projectId: string, public name: string, public role: ProjectRole) {}
}

export class UpdateProjectClient {
  static readonly type = '[ProjectClient] Update project client';
  constructor(public projectId: string, public clientId: string, public role: ProjectRole) {}
}

export class RemoveProjectClient {
  static readonly type = '[ProjectClient] Remove project client';
  constructor(public projectId: string, public clientId: string) {}
}

export interface ProjectClientStateModel {
  clients: ProjectClient[];
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults = {
  clients: [],
  isLoading: false,
  errorMessage: undefined,
};

@State<ProjectClientStateModel>({
  name: 'projectClients',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class ProjectClientState implements NgxsOnInit {
  constructor(private projectClientService: ProjectClientService, private store: Store) {}

  @Selector()
  static isLoading(state: ProjectClientStateModel) {
    return state.isLoading;
  }

  @Selector()
  static clients(state: ProjectClientStateModel) {
    return state.clients;
  }

  ngxsOnInit(ctx: StateContext<ProjectClientStateModel>) {}

  @Action(Logout)
  logout(ctx: StateContext<ProjectClientStateModel>, action: Logout) {
    ctx.setState(stateDefaults);
  }

  @Action(GetProjectClients)
  getProjectClients(ctx: StateContext<ProjectClientStateModel>, action: GetProjectClients) {
    ctx.patchState({ isLoading: true });
    return this.projectClientService.find(action.projectId).pipe(
      tap(clients => ctx.patchState({ clients })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(AddProjectClient)
  addProjectClient(ctx: StateContext<ProjectClientStateModel>, action: AddProjectClient) {
    ctx.patchState({ isLoading: true });
    return this.projectClientService.create(action.projectId, action.name, action.role).pipe(
      tap(client => ctx.patchState({ clients: [client, ...ctx.getState().clients] })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error, 'AddProjectClient') });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateProjectClient)
  updateProjectClient(ctx: StateContext<ProjectClientStateModel>, action: UpdateProjectClient) {
    ctx.patchState({ isLoading: true });
    return this.projectClientService.update(action.projectId, action.clientId, action.role).pipe(
      tap(updatedClient => {
        const clients = ctx.getState().clients.map(u => {
          if (u.id === updatedClient.id) {
            return updatedClient;
          } else {
            return u;
          }
        });
        ctx.patchState({ clients });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(RemoveProjectClient)
  removeProjectClient(ctx: StateContext<ProjectClientStateModel>, action: RemoveProjectClient) {
    ctx.patchState({ isLoading: true });
    return this.projectClientService.remove(action.projectId, action.clientId).pipe(
      tap(() => {
        const clients = ctx.getState().clients.filter(u => u.id !== action.clientId);
        ctx.patchState({ clients });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<ProjectClientStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }

  @Action(ClearCurrentProject)
  clearCurrentProject(ctx: StateContext<ProjectClientStateModel>) {
    ctx.patchState(stateDefaults);
  }
}
