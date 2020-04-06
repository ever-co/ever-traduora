import { Action, NgxsOnInit, Selector, State, StateContext, Store } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { errorToMessage } from '../../shared/util/api-error';
import { Label } from '../models/label';
import { ProjectLabelService } from '../services/project-label.service';
import { ClearCurrentProject } from './projects.state';
import { Injectable } from '@angular/core';

export class ClearMessages {
  static readonly type = '[ProjectLabel] Clear messages';
}

export class GetProjectLabels {
  static readonly type = '[ProjectLabel] Get project labels';
  constructor(public projectId: string) {}
}

export class CreateProjectLabel {
  static readonly type = '[ProjectLabel] Create project label';
  constructor(public projectId: string, public value: string, public color: string) {}
}

export class UpdateProjectLabel {
  static readonly type = '[ProjectLabel] Update project label';
  constructor(public projectId: string, public labelId: string, public value: string, public color: string) {}
}

export class RemoveProjectLabel {
  static readonly type = '[ProjectLabel] Remove project label';
  constructor(public projectId: string, public labelId: string) {}
}

export class LabelTerm {
  static readonly type = '[ProjectLabel] Label term';
  constructor(public projectId: string, public label: Label, public termId: string) {}
}

export class UnlabelTerm {
  static readonly type = '[ProjectLabel] Unlabel term';
  constructor(public projectId: string, public label: Label, public termId: string) {}
}

export class LabelTranslation {
  static readonly type = '[ProjectLabel] Label translation';
  constructor(public projectId: string, public label: Label, public termId: string, public localeCode: string) {}
}

export class UnlabelTranslation {
  static readonly type = '[ProjectLabel] Unlabel translation';
  constructor(public projectId: string, public label: Label, public termId: string, public localeCode: string) {}
}

export interface ProjectLabelStateModel {
  labels: Label[];
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults = {
  labels: [],
  isLoading: false,
  errorMessage: undefined,
};

@State<ProjectLabelStateModel>({
  name: 'projectLabels',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class ProjectLabelState implements NgxsOnInit {
  constructor(private projectLabelsService: ProjectLabelService, private store: Store) {}

  @Selector()
  static labels(state: ProjectLabelStateModel) {
    return state.labels;
  }

  @Selector()
  static isLoading(state: ProjectLabelStateModel) {
    return state.isLoading;
  }

  @Selector()
  static errorMessage(state: ProjectLabelStateModel) {
    return state.errorMessage;
  }

  ngxsOnInit(ctx: StateContext<ProjectLabelStateModel>) {}

  @Action(GetProjectLabels)
  getProjectLabels(ctx: StateContext<ProjectLabelStateModel>, action: GetProjectLabels) {
    ctx.patchState({ isLoading: true });
    return this.projectLabelsService.find(action.projectId).pipe(
      tap(labels => {
        ctx.patchState({ labels });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(CreateProjectLabel)
  createProjectLabel(ctx: StateContext<ProjectLabelStateModel>, action: CreateProjectLabel) {
    ctx.patchState({ isLoading: true });
    return this.projectLabelsService.create(action.projectId, action.value, action.color).pipe(
      tap(newLabel => {
        const labels = [...ctx.getState().labels, newLabel];
        ctx.patchState({ labels });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateProjectLabel)
  updateProjectLabel(ctx: StateContext<ProjectLabelStateModel>, action: UpdateProjectLabel) {
    ctx.patchState({ isLoading: true });
    return this.projectLabelsService.update(action.projectId, action.labelId, action.value, action.color).pipe(
      tap(updatedLabel => {
        const labels = ctx.getState().labels.map(v => {
          if (v.id === updatedLabel.id) {
            return updatedLabel;
          } else {
            return v;
          }
        });
        ctx.patchState({ labels });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(RemoveProjectLabel)
  removeProjectLabel(ctx: StateContext<ProjectLabelStateModel>, action: RemoveProjectLabel) {
    ctx.patchState({ isLoading: true });
    return this.projectLabelsService.remove(action.projectId, action.labelId).pipe(
      tap(() => {
        const labels = ctx.getState().labels.filter(v => v.id !== action.labelId);
        ctx.patchState({ labels });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(LabelTerm)
  labelTerm(ctx: StateContext<ProjectLabelStateModel>, action: LabelTerm) {
    ctx.patchState({ isLoading: true });
    return this.projectLabelsService.labelTerm(action.projectId, action.label.id, action.termId).pipe(
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UnlabelTerm)
  unlabelTerm(ctx: StateContext<ProjectLabelStateModel>, action: UnlabelTerm) {
    ctx.patchState({ isLoading: true });
    return this.projectLabelsService.unlabelTerm(action.projectId, action.label.id, action.termId).pipe(
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(LabelTranslation)
  labelTranslation(ctx: StateContext<ProjectLabelStateModel>, action: LabelTranslation) {
    ctx.patchState({ isLoading: true });
    return this.projectLabelsService.labelTranslation(action.projectId, action.label.id, action.termId, action.localeCode).pipe(
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UnlabelTranslation)
  unlabelTranslation(ctx: StateContext<ProjectLabelStateModel>, action: UnlabelTranslation) {
    ctx.patchState({ isLoading: true });
    return this.projectLabelsService.unlabelTranslation(action.projectId, action.label.id, action.termId, action.localeCode).pipe(
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<ProjectLabelStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }

  @Action(ClearCurrentProject)
  clearCurrentProject(ctx: StateContext<ProjectLabelStateModel>) {
    ctx.patchState(stateDefaults);
  }
}
