import { Navigate } from '@ngxs/router-plugin';
import { Action, NgxsOnInit, Selector, State, StateContext } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, switchMap, tap, map } from 'rxjs/operators';
import { Logout } from '../../auth/stores/auth.state';
import { errorToMessage } from '../../shared/util/api-error';
import { Project } from '../models/project';
import { ProjectsService } from '../services/projects.service';
import { ProjectStats } from '../models/project-stats';
import { ProjectStatsService } from '../services/project-stats.service';
import { Injectable } from '@angular/core';

export class ClearMessages {
  static readonly type = '[Projects] ClearMessages';
}

export class GetProjects {
  static readonly type = '[Projects] Get projects';
}

export class ClearCurrentProject {
  static readonly type = '[Projects] Clear current project';
}

export class SetCurrentProject {
  static readonly type = '[Projects] Set current project';
  constructor(public id: string) {}
}

export class RefreshProjectStats {
  static readonly type = '[Projects] Refresh current project stats';
  constructor() {}
}

export class UpdateProject {
  static readonly type = '[Projects] Update project';
  constructor(public id: string, public data: { name?: string; description?: string }) {}
}

export class DeleteProject {
  static readonly type = '[Projects] Delete project';
  constructor(public id: string) {}
}

export class CreateProject {
  static readonly type = '[Projects] Create project';
  constructor(public name: string, public description: string) {}
}

export class ReloadCurrentProject {
  static readonly type = '[Projects] Reload current project';
}

export interface ProjectsStateModel {
  projects: Project[];
  currentProject: Project | undefined;
  currentProjectStats: ProjectStats | undefined;
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults = {
  projects: [],
  currentProject: undefined,
  currentProjectStats: undefined,
  isLoading: false,
  errorMessage: undefined,
};

@State<ProjectsStateModel>({
  name: 'projects',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class ProjectsState implements NgxsOnInit {
  constructor(private projectsService: ProjectsService, private projectStatsService: ProjectStatsService) {}

  @Selector()
  static projects(state: ProjectsStateModel) {
    return state.projects;
  }

  @Selector()
  static isLoading(state: ProjectsStateModel) {
    return state.isLoading;
  }

  @Selector()
  static currentProject(state: ProjectsStateModel) {
    return state.currentProject;
  }

  @Selector()
  static currentProjectStats(state: ProjectsStateModel) {
    return state.currentProjectStats;
  }

  ngxsOnInit(ctx: StateContext<ProjectsStateModel>) {}

  @Action(Logout)
  logout(ctx: StateContext<ProjectsStateModel>, action: Logout) {
    ctx.setState(stateDefaults);
  }

  @Action(GetProjects)
  getProjects(ctx: StateContext<ProjectsStateModel>) {
    ctx.patchState({ isLoading: true });
    return this.projectsService.find().pipe(
      tap(projects => ctx.patchState({ projects })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(CreateProject)
  createProject(ctx: StateContext<ProjectsStateModel>, action: CreateProject) {
    ctx.patchState({ isLoading: true });
    return this.projectsService.create(action).pipe(
      tap(project => {
        ctx.patchState({ projects: [project, ...ctx.getState().projects] });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateProject)
  updateProject(ctx: StateContext<ProjectsStateModel>, action: UpdateProject) {
    ctx.patchState({ isLoading: true });
    return this.projectsService.update(action.id, action.data).pipe(
      tap(project => {
        const currentProject = ctx.getState().currentProject;
        if (project.id === currentProject.id) {
          ctx.patchState({ currentProject: { ...currentProject, ...project } });
        }
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(DeleteProject)
  deleteProject(ctx: StateContext<ProjectsStateModel>, action: DeleteProject) {
    ctx.patchState({ isLoading: true });
    return this.projectsService.delete(action.id).pipe(
      tap(() => {
        ctx.dispatch(new Navigate(['/projects']));
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(SetCurrentProject)
  setCurrentProject(ctx: StateContext<ProjectsStateModel>, action: SetCurrentProject) {
    ctx.patchState({ isLoading: true, currentProject: undefined });
    return this.projectsService.findOne(action.id).pipe(
      switchMap(project =>
        this.projectsService.findPlan(action.id).pipe(
          tap(plan => {
            project.plan = plan;
            ctx.patchState({ currentProject: project });
          }),
        ),
      ),
      tap(() => ctx.dispatch(new RefreshProjectStats())),
      catchError(error => {
        if (error.status === 404) {
          ctx.dispatch(new Navigate(['404']));
        }
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ReloadCurrentProject)
  reloadCurrentProject(ctx: StateContext<ProjectsStateModel>) {
    ctx.patchState({ isLoading: true });
    const projectId = ctx.getState().currentProject.id;
    return this.projectsService.findOne(projectId).pipe(
      switchMap(project =>
        this.projectsService.findPlan(projectId).pipe(
          tap(plan => {
            project.plan = plan;
            ctx.patchState({ currentProject: project });
          }),
        ),
      ),
      catchError(error => {
        if (error.status === 404) {
          ctx.dispatch(new Navigate(['404']));
        }
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(RefreshProjectStats)
  refreshProjectStats(ctx: StateContext<ProjectsStateModel>) {
    ctx.patchState({ isLoading: true });
    const projectId = ctx.getState().currentProject.id;
    return this.projectStatsService.getStats(projectId).pipe(
      map(stats => ctx.patchState({ currentProjectStats: stats })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ClearCurrentProject)
  clearCurrentProject(ctx: StateContext<ProjectsStateModel>) {
    ctx.patchState({ currentProject: undefined, errorMessage: undefined });
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<ProjectsStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }
}
