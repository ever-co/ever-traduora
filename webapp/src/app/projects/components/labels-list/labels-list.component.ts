import { Component, OnDestroy, OnInit } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';
import { Project } from '../../models/project';
import { Label } from '../../models/label';
import {
  ClearMessages,
  CreateProjectLabel,
  GetProjectLabels,
  ProjectLabelState,
  RemoveProjectLabel,
  UpdateProjectLabel,
} from '../../stores/project-label.state';
import { ProjectsState } from '../../stores/projects.state';
import { TAG_COLORS } from '../../models/label';
@Component({
  selector: 'app-labels-list',
  templateUrl: './labels-list.component.html',
  styleUrls: ['./labels-list.component.css'],
})
export class LabelsListComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(ProjectLabelState.labels)
  projectLabels$: Observable<Label[]>;

  @Select(ProjectLabelState.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projectLabels.errorMessage)
  errorMessage$: Observable<string | undefined>;

  newValue = '';

  page = 0;
  pageSize = 10;

  searchText = new BehaviorSubject('');
  searchResults$: Observable<Label[]> = this.searchText.pipe(
    debounceTime(50),
    distinctUntilChanged(),
    map(search =>
      search
        .trim()
        .toLowerCase()
        .split(' '),
    ),
    switchMap(searchTerms =>
      this.projectLabels$.pipe(
        map(results => {
          if (searchTerms.length === 0) {
            return results;
          }
          return results.filter(r => {
            const value = r.value;
            for (const term of searchTerms) {
              if (value.indexOf(term) === -1) {
                return false;
              }
            }
            return true;
          });
        }),
      ),
    ),
  );

  private sub: Subscription;

  searchKey = (item: Label) => item.value;

  constructor(private store: Store) {}

  ngOnInit() {
    this.sub = this.project$.pipe(tap(project => this.store.dispatch(new GetProjectLabels(project.id)))).subscribe();
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.store.dispatch(new ClearMessages());
  }

  onCreate(projectId: string, value: string, color: string = '#404040') {
    if (!value) {
      return;
    }
    this.store.dispatch(new ClearMessages());
    this.store.dispatch(new CreateProjectLabel(projectId, value, color));
  }

  updateLabel(projectId, labelId, newValue, newColor) {
    this.store.dispatch(new UpdateProjectLabel(projectId, labelId, newValue, newColor));
  }

  deleteLabel(projectId, labelId) {
    if (confirm('Are you sure that you want to delete this label?')) {
      this.store.dispatch(new RemoveProjectLabel(projectId, labelId));
    }
  }

  trackElement(index: number, label: Label) {
    return label.id;
  }
}
