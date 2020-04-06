import { Action, NgxsOnInit, Selector, State, StateContext } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Logout } from '../../auth/stores/auth.state';
import { errorToMessage } from '../../shared/util/api-error';
import { Term } from '../models/term';
import { ProjectTermsService } from '../services/terms.service';
import { ClearCurrentProject, RefreshProjectStats } from './projects.state';
import { LabelTerm, UnlabelTerm } from './project-label.state';
import { Injectable } from '@angular/core';

export class ClearMessages {
  static readonly type = '[Terms] Clear messages';
}

export class GetTerms {
  static readonly type = '[Terms] Get terms';
  constructor(public projectId: string) {}
}

export class CreateTerm {
  static readonly type = '[Terms] Create term';
  constructor(public projectId: string, public value: string) {}
}

export class UpdateTerm {
  static readonly type = '[Terms] Update term';
  constructor(public projectId: string, public termId: string, public value: string) {}
}

export class DeleteTerm {
  static readonly type = '[Terms] Delete term';
  constructor(public projectId: string, public termId: string) {}
}

export interface TermsStateModel {
  terms: Term[];
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults = {
  terms: [],
  isLoading: false,
  errorMessage: undefined,
};

@State<TermsStateModel>({
  name: 'terms',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class TermsState implements NgxsOnInit {
  constructor(private termService: ProjectTermsService) {}

  @Selector()
  static isLoading(state: TermsStateModel) {
    return state.isLoading;
  }

  @Selector()
  static terms(state: TermsStateModel) {
    return state.terms;
  }

  ngxsOnInit(ctx: StateContext<TermsStateModel>) {}

  @Action(Logout)
  logout(ctx: StateContext<TermsStateModel>, action: Logout) {
    ctx.setState(stateDefaults);
  }

  @Action(GetTerms)
  getTerms(ctx: StateContext<TermsStateModel>, action: GetTerms) {
    ctx.patchState({ isLoading: true });
    return this.termService.find(action.projectId).pipe(
      tap(terms => ctx.patchState({ terms })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(CreateTerm)
  createTerms(ctx: StateContext<TermsStateModel>, action: CreateTerm) {
    ctx.patchState({ isLoading: true });
    return this.termService.create(action.projectId, action.value).pipe(
      tap(term => ctx.patchState({ terms: [term, ...ctx.getState().terms] })),
      tap(() => ctx.dispatch(new RefreshProjectStats())),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(UpdateTerm)
  updateTerms(ctx: StateContext<TermsStateModel>, action: UpdateTerm) {
    ctx.patchState({ isLoading: true });
    return this.termService.update(action.projectId, action.termId, action.value).pipe(
      tap(term => {
        const terms = ctx.getState().terms.map(t => {
          if (t.id === term.id) {
            return term;
          } else {
            return t;
          }
        });
        ctx.patchState({ terms });
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(DeleteTerm)
  deleteTerms(ctx: StateContext<TermsStateModel>, action: DeleteTerm) {
    ctx.patchState({ isLoading: true });
    return this.termService.delete(action.projectId, action.termId).pipe(
      tap(() => {
        const terms = ctx.getState().terms.filter(t => t.id !== action.termId);
        ctx.patchState({ terms });
      }),
      tap(() => ctx.dispatch(new RefreshProjectStats())),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(LabelTerm)
  labelTerm(ctx: StateContext<TermsStateModel>, action: LabelTerm) {
    const terms = ctx.getState().terms;
    const updated = terms.map(v => {
      if (v.id === action.termId) {
        return { ...v, labels: [...v.labels, action.label] };
      }
      return v;
    });
    ctx.patchState({ terms: updated });
  }

  @Action(UnlabelTerm)
  unlabelTerm(ctx: StateContext<TermsStateModel>, action: UnlabelTerm) {
    const terms = ctx.getState().terms;
    const updated = terms.map(v => {
      if (v.id === action.termId) {
        return { ...v, labels: v.labels.filter(t => t.id !== action.label.id) };
      }
      return v;
    });
    ctx.patchState({ terms: updated });
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<TermsStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }

  @Action(ClearCurrentProject)
  clearCurrentProject(ctx: StateContext<TermsStateModel>) {
    ctx.patchState({ terms: [], errorMessage: undefined });
  }
}
