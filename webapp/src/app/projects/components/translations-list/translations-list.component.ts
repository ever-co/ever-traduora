import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Navigate } from '@ngxs/router-plugin';
import { Select, Store } from '@ngxs/store';
import { keyBy } from 'lodash';
import { BehaviorSubject, combineLatest, Observable, Subscription, Subject } from 'rxjs';
import { filter, flatMap, map, tap } from 'rxjs/operators';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
import { ProjectLocale } from '../../models/project-locale';
import { Term } from '../../models/term';
import { Translation } from '../../models/translation';
import { PreferencesService } from '../../services/preferences.service';
import { ProjectsState } from '../../stores/projects.state';
import { GetTerms, TermsState } from '../../stores/terms.state';
import {
  ClearMessages,
  DeleteProjectLocale,
  GetKnownLocales,
  GetProjectLocales,
  GetTranslations,
  TranslationsState,
  UpdateTranslation,
} from '../../stores/translations.state';

@Component({
  selector: 'app-translations-list',
  templateUrl: './translations-list.component.html',
  styleUrls: ['./translations-list.component.css'],
})
export class TranslationsListComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(TermsState.terms)
  terms$: Observable<Term[]>;

  @Select(TranslationsState.projectTranslations)
  allTranslations$: Observable<{ [localeCode: string]: Translation[] }>;

  @Select(TranslationsState.knownLocales)
  knownLocales$: Observable<Locale[]>;

  @Select(TranslationsState.projectLocales)
  projectLocales$: Observable<ProjectLocale[]>;

  @Select(state => state.terms.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.terms.errorMessage)
  errorMessage$: Observable<string | undefined>;

  localeCode$: Observable<string | undefined> = this.route.paramMap.pipe(map(params => params.get('localeCode')));

  currentLocale$: Observable<Locale | undefined> = combineLatest(this.knownLocales$, this.localeCode$).pipe(
    map(([knownLocales, localeCode]) => knownLocales.find(l => l.code === localeCode)),
  );

  private referenceLocale = new BehaviorSubject<Locale | undefined>(undefined);
  referenceLocale$ = combineLatest(this.referenceLocale.asObservable(), this.currentLocale$).pipe(
    map(([refLocale, currentLocale]) => (this.sameLocale(refLocale, currentLocale) ? undefined : refLocale)),
  );

  private filterTranslated: Subject<boolean> = new BehaviorSubject(false);
  filterTranslated$ = this.filterTranslated.asObservable();

  translations$ = combineLatest(this.allTranslations$, this.localeCode$, this.terms$, this.referenceLocale$, this.filterTranslated$).pipe(
    map(([translations, localeCode, terms, referenceLocale, filterTranslated]) =>
      this.translationsView(translations, terms, localeCode, referenceLocale ? referenceLocale.code : undefined, { filterTranslated }),
    ),
  );

  private subs: Subscription[] = [];

  constructor(private store: Store, private route: ActivatedRoute, private router: Router, private preferencesService: PreferencesService) {}

  ngOnInit() {
    this.subs.push(
      this.project$
        .pipe(
          filter(project => !!project),
          tap(project => {
            this.store.dispatch([new GetProjectLocales(project.id), new GetKnownLocales(), new GetTerms(project.id)]);
          }),
          flatMap(project => {
            return this.localeCode$.pipe(map(localeCode => this.store.dispatch(new GetTranslations(project.id, localeCode))));
          }),
        )
        .subscribe(),
    );

    this.subs.push(
      combineLatest(this.project$, this.knownLocales$, this.projectLocales$)
        .pipe(
          tap(res => {
            const [project, knownLocales, projectLocales] = res;
            if (project && knownLocales && projectLocales) {
              this.loadReferenceLocalePreference(project, knownLocales, projectLocales);
            }
          }),
        )
        .subscribe(),
    );
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
    this.store.dispatch(new ClearMessages());
  }

  onFiltersChanged(filterTranslated) {
    this.filterTranslated.next(filterTranslated);
  }

  updateTranslation(projectId: string, localeCode: string, termId: string, value: string) {
    this.store.dispatch(new UpdateTranslation(projectId, localeCode, termId, value));
  }

  deleteProjectLocale(projectId: string, localeCode: string) {
    if (confirm(`Are you sure you want to delete the project locale with code '${localeCode}'?`)) {
      this.store
        .dispatch(new DeleteProjectLocale(projectId, localeCode))
        .toPromise()
        .then(() => this.router.navigate(['projects', projectId, 'translations']));
    }
  }

  searchKey(item: { term: Term; value: string; valueRef: string }): string {
    return `${item.term.value}${item.value}${item.valueRef}`.toLowerCase();
  }

  trackElement(index: number, element: { term: Term; value: string; valueRef: string }) {
    return element.term.id;
  }

  asLocales(projectLocales: ProjectLocale[]): Locale[] {
    if (projectLocales) {
      return projectLocales.map(pl => pl.locale);
    }
    return [];
  }

  setCurrentLocale(project: Project, locale: Locale) {
    if (locale) {
      this.store.dispatch(new Navigate(['projects', project.id, 'translations', locale.code]));
    }
  }

  async setReferenceLocale(project: Project, locale: Locale) {
    if (locale) {
      await this.store.dispatch(new GetTranslations(project.id, locale.code));
      this.preferencesService.forProject(project.id).referenceLanguage.set(locale.code);
    }
    this.referenceLocale.next(locale);
  }

  removeReferenceLocale(project: Project) {
    this.preferencesService.forProject(project.id).referenceLanguage.remove();
    this.referenceLocale.next(undefined);
  }

  private translationsView(
    translationsIndex: { [localeCode: string]: Translation[] },
    terms: Term[],
    localeCode: string,
    referenceLocaleCode: string | undefined,
    options: { filterTranslated: boolean | undefined },
  ): { term: Term; value: string; valueRef: string }[] {
    // Find translations for locales, fallback to empty list if not found.
    const mainTranslations = translationsIndex[localeCode] || [];
    const refTranslations = referenceLocaleCode ? translationsIndex[referenceLocaleCode] || [] : [];

    const mainTranslationsByTermId = keyBy(mainTranslations, t => t.termId);
    const refTranslationsByTermId = keyBy(refTranslations, t => t.termId);

    // Assemble view
    const values = terms.map(term => {
      const translation = mainTranslationsByTermId[term.id];
      const refTranslation = refTranslationsByTermId[term.id];
      return {
        term,
        value: translation ? translation.value : '',
        valueRef: refTranslation ? refTranslation.value : '',
      };
    });

    if (options.filterTranslated) {
      return values.filter(t => !t.value || t.value.length === 0);
    }

    return values;
  }

  private loadReferenceLocalePreference(project: Project, knownLocales: Locale[], projectLocales: ProjectLocale[]) {
    const refLanguageCode = this.preferencesService.forProject(project.id).referenceLanguage.get();
    let preference: Locale | undefined;
    if (refLanguageCode) {
      preference = knownLocales.find(l => l.code === refLanguageCode);
    }
    // Ensure locale is in project locales to avoid a 404
    if (preference && projectLocales.find(l => l.locale.code === preference.code)) {
      this.setReferenceLocale(project, preference);
    }
  }

  private sameLocale(a: Locale, b: Locale): boolean {
    if (a && b) {
      return a.code === b.code;
    }
    return a === b;
  }
}
