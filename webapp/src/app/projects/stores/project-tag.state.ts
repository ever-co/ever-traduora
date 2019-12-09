import { Action, NgxsOnInit, Selector, State, StateContext, Store } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { errorToMessage } from '../../shared/util/api-error';
import { Tag } from '../models/tag';
import { ProjectTagService } from '../services/project-tag.service';
import { ClearCurrentProject } from './projects.state';

export class ClearMessages {
  static readonly type = '[ProjectTag] Clear messages';
}

export class GetProjectTags {
  static readonly type = '[ProjectTag] Get project tags';
  constructor(public projectId: string) {}
}

export class CreateProjectTag {
  static readonly type = '[ProjectTag] Create project tag';
  constructor(public projectId: string, public value: string, public color: string) {}
}

export class UpdateProjectTag {
  static readonly type = '[ProjectTag] Update project tag';
  constructor(public projectId: string, public tagId: string, public value: string, public color: string) {}
}

export class RemoveProjectTag {
  static readonly type = '[ProjectTag] Remove project tag';
  constructor(public projectId: string, public tagId: string) {}
}

export interface ProjectTagStateModel {
  tags: Tag[];
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults = {
  tags: [],
  isLoading: false,
  errorMessage: undefined,
};

@State<ProjectTagStateModel>({
  name: 'projectTags',
  defaults: stateDefaults,
})
export class ProjectTagState implements NgxsOnInit {
  constructor(private projectTagsService: ProjectTagService, private store: Store) {}

  @Selector()
  static tags(state: ProjectTagStateModel) {
    return state.tags;
  }

  @Selector()
  static isLoading(state: ProjectTagStateModel) {
    return state.isLoading;
  }

  ngxsOnInit(ctx: StateContext<ProjectTagStateModel>) {}

  @Action(GetProjectTags)
  getProjectTags(ctx: StateContext<ProjectTagStateModel>, action: GetProjectTags) {
    ctx.patchState({ isLoading: true });
    return this.projectTagsService.find(action.projectId).pipe(
      tap(tags => {
        ctx.patchState({ tags });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(CreateProjectTag)
  createProjectTag(ctx: StateContext<ProjectTagStateModel>, action: CreateProjectTag) {
    ctx.patchState({ isLoading: true });
    return this.projectTagsService.create(action.projectId, action.value, action.color).pipe(
      tap(newTag => {
        const tags = [...ctx.getState().tags, newTag];
        ctx.patchState({ tags });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateProjectTag)
  updateProjectTag(ctx: StateContext<ProjectTagStateModel>, action: UpdateProjectTag) {
    ctx.patchState({ isLoading: true });
    return this.projectTagsService.update(action.projectId, action.tagId, action.value, action.color).pipe(
      tap(updatedTag => {
        const tags = ctx.getState().tags.map(v => {
          if (v.id === updatedTag.id) {
            return updatedTag;
          } else {
            return v;
          }
        });
        ctx.patchState({ tags });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(RemoveProjectTag)
  removeProjectTag(ctx: StateContext<ProjectTagStateModel>, action: RemoveProjectTag) {
    ctx.patchState({ isLoading: true });
    return this.projectTagsService.remove(action.projectId, action.tagId).pipe(
      tap(() => {
        const tags = ctx.getState().tags.filter(v => v.id !== action.tagId);
        ctx.patchState({ tags });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<ProjectTagStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }

  @Action(ClearCurrentProject)
  clearCurrentProject(ctx: StateContext<ProjectTagStateModel>) {
    ctx.patchState(stateDefaults);
  }
}
