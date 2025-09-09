import { Component, OnDestroy, OnInit } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
import { ProjectLocale } from '../../models/project-locale';
import { ProjectsState } from '../../stores/projects.state';
import { ClearMessages, GetProjectLocales, TranslationsState } from '../../stores/translations.state';

@Component({
  selector: 'app-export-container',
  templateUrl: './export-container.component.html',
  styleUrls: ['./export-container.component.css'],
})
export class ExportContainerComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(TranslationsState.projectLocales)
  projectLocales$!: Observable<ProjectLocale[]>;

  @Select(TranslationsState.isLoading)
  isLoading$: Observable<boolean>;

  existingLocales$: Observable<Locale[]> = this.projectLocales$.pipe(map(x => x.map(y => y.locale)));

  constructor(private store: Store) {}

  sub: Subscription;

  async ngOnInit() {
    this.sub = this.project$.pipe(tap(project => this.store.dispatch(new GetProjectLocales(project.id)))).subscribe();
  }

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
    this.sub.unsubscribe();
  }
}
