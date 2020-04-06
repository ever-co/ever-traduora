import { Navigate } from '@ngxs/router-plugin';
import { Action, NgxsOnInit, Selector, State, StateContext } from '@ngxs/store';
import { throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';
import { Logout } from '../../auth/stores/auth.state';
import { errorToMessage } from '../../shared/util/api-error';
import { Locale } from '../models/locale';
import { ProjectLocale } from '../models/project-locale';
import { Translation } from '../models/translation';
import { ProjectTranslationsService } from '../services/translations.service';
import { ClearCurrentProject, RefreshProjectStats } from './projects.state';
import { LabelTranslation, UnlabelTranslation } from './project-label.state';
import { Injectable } from '@angular/core';
import { sortBy } from 'lodash';

export class ClearMessages {
  static readonly type = '[Translations] Clear messages';
}

export class GetKnownLocales {
  static readonly type = '[Translations] Get known locales';
}

export class GetProjectLocales {
  static readonly type = '[Translations] Get project locales';
  constructor(public projectId: string) {}
}

export class AddProjectLocale {
  static readonly type = '[Translations] Add project locale';
  constructor(public projectId: string, public localeCode: string) {}
}

export class DeleteProjectLocale {
  static readonly type = '[Translations] Delete project locale';
  constructor(public projectId: string, public localeCode: string) {}
}

export class GetTranslations {
  static readonly type = '[Translations] Get translation';
  constructor(public projectId: string, public localeCode: string) {}
}

export class UpdateTranslation {
  static readonly type = '[Translations] Update translation';
  constructor(public projectId: string, public localeCode: string, public termId: string, public value: string) {}
}

export interface TranslationsStateModel {
  projectLocales: ProjectLocale[];
  knownLocales: Locale[];
  translations: { [localeCode: string]: Translation[] };
  isLoading: boolean;
  errorMessage: string | undefined;
}

const stateDefaults = {
  projectLocales: [],
  knownLocales: [],
  translations: {},
  isLoading: false,
  errorMessage: undefined,
};

@State<TranslationsStateModel>({
  name: 'translations',
  defaults: stateDefaults,
})
@Injectable({ providedIn: 'root' })
export class TranslationsState implements NgxsOnInit {
  constructor(private translationService: ProjectTranslationsService) {}

  @Selector()
  static isLoading(state: TranslationsStateModel) {
    return state.isLoading;
  }

  @Selector()
  static projectLocales(state: TranslationsStateModel) {
    return state.projectLocales;
  }

  @Selector()
  static projectTranslations(state: TranslationsStateModel) {
    return state.translations;
  }

  @Selector()
  static knownLocales(state: TranslationsStateModel) {
    return state.knownLocales;
  }

  ngxsOnInit(ctx: StateContext<TranslationsStateModel>) {}

  @Action(Logout)
  logout(ctx: StateContext<TranslationsStateModel>, action: Logout) {
    ctx.setState(stateDefaults);
  }

  @Action(GetKnownLocales)
  getKnownLocales(ctx: StateContext<TranslationsStateModel>, action: GetKnownLocales) {
    ctx.patchState({ isLoading: true });
    return this.translationService.loadKnownLocales().pipe(
      tap(knownLocales => ctx.patchState({ knownLocales })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(GetProjectLocales)
  getProjectLocales(ctx: StateContext<TranslationsStateModel>, action: GetProjectLocales) {
    ctx.patchState({ isLoading: true });
    return this.translationService.findProjectLocales(action.projectId).pipe(
      tap(projectLocales => ctx.patchState({ projectLocales: sortBy(projectLocales, v => v.locale.code) })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(AddProjectLocale)
  addProjectLocale(ctx: StateContext<TranslationsStateModel>, action: AddProjectLocale) {
    ctx.patchState({ isLoading: true });
    return this.translationService.addProjectLocale(action.projectId, action.localeCode).pipe(
      tap(projectLocale => ctx.patchState({ projectLocales: [...ctx.getState().projectLocales, projectLocale] })),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      tap(() => ctx.dispatch(new RefreshProjectStats())),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(DeleteProjectLocale)
  deleteProjectLocale(ctx: StateContext<TranslationsStateModel>, action: AddProjectLocale) {
    ctx.patchState({ isLoading: true });
    return this.translationService.deleteProjectLocale(action.projectId, action.localeCode).pipe(
      tap(() =>
        ctx.patchState({
          projectLocales: ctx.getState().projectLocales.filter(x => x.locale.code !== action.localeCode),
        }),
      ),
      tap(() => ctx.dispatch(new RefreshProjectStats())),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(GetTranslations)
  getTranslations(ctx: StateContext<TranslationsStateModel>, action: GetTranslations) {
    ctx.patchState({ isLoading: true });
    return this.translationService.findProjectTranslation(action.projectId, action.localeCode).pipe(
      tap(translation =>
        ctx.patchState({
          translations: { ...ctx.getState().translations, [action.localeCode]: translation },
        }),
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

  @Action(UpdateTranslation)
  updateTranslation(ctx: StateContext<TranslationsStateModel>, action: UpdateTranslation) {
    ctx.patchState({ isLoading: true });
    return this.translationService.updateTranslation(action.projectId, action.localeCode, action.termId, action.value).pipe(
      tap(translation => {
        const storeTranslations = ctx.getState().translations;
        // Try to find translation in project locale and update it,
        // if not found then add it to translations. This can happen with
        // newly added terms.
        let found = false;
        let previousValue;
        const forLocale = storeTranslations[action.localeCode].map(tr => {
          if (tr.termId === translation.termId) {
            found = true;
            previousValue = tr.value;
            return translation;
          }
          return tr;
        });
        if (!found) {
          forLocale.push(translation);
        }
        const translations = { ...storeTranslations, [action.localeCode]: forLocale };
        ctx.patchState({ translations });

        // Only refresh project stats if necessary
        const newValueIsEmpty = !translation.value || translation.value === '';
        const previousValueIsEmpty = !previousValue || previousValue === '';
        const isAddition = previousValueIsEmpty && !newValueIsEmpty;
        const isRemoval = !previousValueIsEmpty && newValueIsEmpty;

        if (isAddition || isRemoval) {
          ctx.dispatch(new RefreshProjectStats());
        }
      }),
      catchError(error => {
        ctx.patchState({ errorMessage: errorToMessage(error) });
        return throwError(error);
      }),
      finalize(() => ctx.patchState({ isLoading: false })),
    );
  }

  @Action(LabelTranslation)
  labelTranslation(ctx: StateContext<TranslationsStateModel>, action: LabelTranslation) {
    const translations = ctx.getState().translations;
    const forLocale = translations[action.localeCode];
    if (forLocale) {
      const updated = forLocale.map(v => {
        if (v.termId === action.termId) {
          return { ...v, labels: [...v.labels, action.label] };
        }
        return v;
      });
      ctx.patchState({ translations: { ...translations, [action.localeCode]: updated } });
    }
  }

  @Action(UnlabelTranslation)
  unlabelTranslation(ctx: StateContext<TranslationsStateModel>, action: UnlabelTranslation) {
    const translations = ctx.getState().translations;
    const forLocale = translations[action.localeCode];
    if (forLocale) {
      const updated = forLocale.map(v => {
        if (v.termId === action.termId) {
          return { ...v, labels: v.labels.filter(t => t.id !== action.label.id) };
        }
        return v;
      });
      ctx.patchState({ translations: { ...translations, [action.localeCode]: updated } });
    }
  }

  @Action(ClearMessages)
  clearMessages(ctx: StateContext<TranslationsStateModel>) {
    ctx.patchState({ errorMessage: undefined });
  }

  @Action(ClearCurrentProject)
  clearCurrentProject(ctx: StateContext<TranslationsStateModel>) {
    ctx.patchState({ projectLocales: [], translations: {}, errorMessage: undefined });
  }
}
