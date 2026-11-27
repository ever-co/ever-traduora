import { Action, Actions, NgxsOnInit, ofActionCompleted, Selector, State, StateContext } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Logout } from '../../auth/stores/auth.state';
import { errorToMessage } from '../../shared/util/api-error';
import { Label } from '../models/label';
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
  constructor(
    public projectId: string,
    public value: string,
    public context?: string,
  ) {}
}

export class UpdateTerm {
  static readonly type = '[Terms] Update term';
  constructor(
    public projectId: string,
    public termId: string,
    public value: string,
    public context?: string,
  ) {}
}

export class DeleteTerm {
  static readonly type = '[Terms] Delete term';
  constructor(
    public projectId: string,
    public termId: string,
  ) {}
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

// The changes of one label on one term that wait for the API
interface UnansweredLabelChanges {
  termId: string;
  labelId: string;
  // Whether the API has the label on the term, as known last: from the terms before the first of these changes or when
  // GetTerms loads them, or from a change the API saved
  saved: boolean;
  waiting: number;
}

const unansweredKey = (action: LabelTerm | UnlabelTerm) => `${action.termId}/${action.label.id}`;

const hasLabel = (terms: Term[], termId: string, labelId: string) => terms.some(t => t.id === termId && t.labels.some(l => l.id === labelId));

@State<TermsStateModel>({
  name: 'terms',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class TermsState implements NgxsOnInit {
  // By term id and label id
  private unansweredLabels = new Map<string, UnansweredLabelChanges>();

  constructor(
    private termService: ProjectTermsService,
    private actions$: Actions,
  ) {}

  @Selector()
  static isLoading(state: TermsStateModel) {
    return state.isLoading;
  }

  @Selector()
  static terms(state: TermsStateModel) {
    return state.terms;
  }

  ngxsOnInit(ctx: StateContext<TermsStateModel>) {
    // A label is added to a term or removed from it here before the API answers (LabelTerm, UnlabelTerm). When the API
    // refuses (a label deleted in another tab, a lost connection), the change is undone, so the term shows its labels as
    // they are. The labels store keeps the error, which the terms page shows.
    // The user can add a label and remove it again before the first answer: undoing each failed change alone would put
    // back a label that was never saved when both fail. So once every change of that label on that term is answered,
    // the term gets the label as the API saved it last. Terms that GetTerms loads while a change waits have the labels as
    // the API has them, which a failed change did not touch: the term then keeps the labels loaded, and a label that
    // another session added meanwhile stays. TermsState lives as long as the app (providedIn root), and so does this
    // subscription.
    this.actions$.pipe(ofActionCompleted(LabelTerm, UnlabelTerm)).subscribe(({ action, result }) => {
      const key = unansweredKey(action);
      const changes = this.unansweredLabels.get(key);
      if (!changes) {
        return;
      }
      changes.waiting--;
      if (result.successful) {
        changes.saved = action instanceof LabelTerm;
      }
      if (changes.waiting > 0) {
        return;
      }
      this.unansweredLabels.delete(key);
      const term = ctx.getState().terms.find(t => t.id === action.termId);
      if (term && term.labels.some(l => l.id === action.label.id) !== changes.saved) {
        this.patchTermLabels(ctx, action.termId, labels =>
          changes.saved ? [...labels, action.label] : labels.filter(l => l.id !== action.label.id),
        );
      }
    });
  }

  // Counts a change of a label on a term that waits for the API. The first one reads whether the term has the label
  // (saved): a change sent while another one waits does not know yet whether that one is saved.
  private waitForAnswer(ctx: StateContext<TermsStateModel>, action: LabelTerm | UnlabelTerm) {
    const key = unansweredKey(action);
    const changes = this.unansweredLabels.get(key);
    if (changes) {
      changes.waiting++;
      return;
    }
    this.unansweredLabels.set(key, {
      termId: action.termId,
      labelId: action.label.id,
      saved: hasLabel(ctx.getState().terms, action.termId, action.label.id),
      waiting: 1,
    });
  }

  @Action(Logout)
  logout(ctx: StateContext<TermsStateModel>, action: Logout) {
    ctx.setState(stateDefaults);
  }

  @Action(GetTerms)
  getTerms(ctx: StateContext<TermsStateModel>, action: GetTerms) {
    ctx.patchState({ isLoading: true });
    return this.termService.find(action.projectId).pipe(
      tap(terms => {
        ctx.patchState({ terms });
        // These terms are newer than what a label change that waits for the API read before it was sent
        this.unansweredLabels.forEach(changes => (changes.saved = hasLabel(terms, changes.termId, changes.labelId)));
      }),
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
    return this.termService.create(action.projectId, action.value, action.context).pipe(
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
    return this.termService.update(action.projectId, action.termId, action.value, action.context).pipe(
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
    this.waitForAnswer(ctx, action);
    const terms = ctx.getState().terms;
    const updated = terms.map(v => {
      if (v.id === action.termId) {
        return { ...v, labels: [...v.labels, action.label] };
      }
      return v;
    });
    // The terms page shows this error before the one of the labels store: an error of an earlier term change goes, so
    // the error of this label change shows
    ctx.patchState({ terms: updated, errorMessage: undefined });
  }

  @Action(UnlabelTerm)
  unlabelTerm(ctx: StateContext<TermsStateModel>, action: UnlabelTerm) {
    this.waitForAnswer(ctx, action);
    const terms = ctx.getState().terms;
    const updated = terms.map(v => {
      if (v.id === action.termId) {
        return { ...v, labels: v.labels.filter(t => t.id !== action.label.id) };
      }
      return v;
    });
    // As in labelTerm: the error of this label change shows, not one of an earlier term change
    ctx.patchState({ terms: updated, errorMessage: undefined });
  }

  private patchTermLabels(ctx: StateContext<TermsStateModel>, termId: string, update: (labels: Label[]) => Label[]) {
    const terms = ctx.getState().terms.map(t => (t.id === termId ? { ...t, labels: update(t.labels) } : t));
    ctx.patchState({ terms });
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
