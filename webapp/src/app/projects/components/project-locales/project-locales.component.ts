import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { combineLatest, Observable, Subscription } from 'rxjs';
import { filter, map, tap } from 'rxjs/operators';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
import { ProjectLocale } from '../../models/project-locale';
import { ProjectLocaleStats, ProjectStats } from '../../models/project-stats';
import { ProjectsState } from '../../stores/projects.state';
import { AddProjectLocale, ClearMessages, GetKnownLocales, GetProjectLocales, TranslationsState } from '../../stores/translations.state';

@Component({
  selector: 'app-project-locales',
  templateUrl: './project-locales.component.html',
  styleUrls: ['./project-locales.component.css'],
})
export class ProjectLocalesComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(TranslationsState.projectLocales)
  projectLocales$: Observable<ProjectLocale[]>;

  @Select(ProjectsState.currentProjectStats)
  projectStats$: Observable<ProjectStats>;

  projectLocalesWithStats$: Observable<(ProjectLocale & { stats: ProjectLocaleStats })[]> = combineLatest([
    this.projectStats$,
    this.projectLocales$,
  ]).pipe(
    map(([stats, projectLocales]) => {
      return projectLocales.map(projectLocale => {
        const found = stats ? stats.localeStats[projectLocale.locale.code] : false;
        const foundOrDefault = found ? found : { progress: 0, total: 1, translated: 0 };
        return { ...projectLocale, stats: foundOrDefault };
      });
    }),
  );

  @Select(TranslationsState.knownLocales)
  knownLocales$: Observable<Locale[]>;

  @Select(state => state.translations.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.translations.errorMessage)
  errorMessage$: Observable<string | undefined>;

  existingLocales$: Observable<Locale[]> = this.projectLocales$.pipe(map(x => x?.map(y => y.locale)));

  private sub: Subscription;

  constructor(private store: Store, private router: Router) {}

  ngOnInit() {
    this.store.dispatch(new GetKnownLocales());
    this.sub = this.project$
      .pipe(
        filter(x => !!x),
        tap(project => this.store.dispatch(new GetProjectLocales(project.id))),
      )
      .subscribe();
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.store.dispatch(new ClearMessages());
  }

  searchKey(item: ProjectLocale): string {
    return `${item.locale.code}${item.locale.language}${item.locale.region}`.toLowerCase();
  }

  trackElement(item: ProjectLocale): any {
    return item.id;
  }

  addLocale = (project: Project, locale: Locale) => {
    this.store.dispatch(new AddProjectLocale(project.id, locale.code));
  };

  async onImportSuccess() {
    await this.project$.pipe(tap(project => this.store.dispatch(new GetProjectLocales(project.id)))).toPromise();
  }
}
