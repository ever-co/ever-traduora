import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
import { ProjectLocale } from '../../models/project-locale';
import { ProjectsState } from '../../stores/projects.state';
import { ClearMessages, GetKnownLocales, GetProjectLocales, TranslationsState } from '../../stores/translations.state';

@Component({
  selector: 'app-import-container',
  templateUrl: './import-container.component.html',
  styleUrls: ['./import-container.component.css'],
})
export class ImportContainerComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(TranslationsState.projectLocales)
  projectLocales$!: Observable<ProjectLocale[]>;

  @Select(TranslationsState.knownLocales)
  knownLocales$: Observable<Locale[]>;

  @Select(TranslationsState.isLoading)
  isLoading$: Observable<boolean>;

  existingLocales$: Observable<Locale[]> = this.projectLocales$.pipe(map(x => x.map(y => y.locale)));

  sub: Subscription;

  constructor(private store: Store, private router: Router) {}

  async ngOnInit() {
    this.store.dispatch(new GetKnownLocales());
    this.sub = this.project$.pipe(tap(project => this.store.dispatch(new GetProjectLocales(project.id)))).subscribe();
  }

  async onImportSuccess() {
    await this.project$.pipe(tap(project => this.store.dispatch(new GetProjectLocales(project.id)))).toPromise();
  }

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
    this.sub.unsubscribe();
  }
}
