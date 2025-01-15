import { Component, OnDestroy, OnInit } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, startWith, switchMap, tap } from 'rxjs/operators';
import { Project } from '../../models/project';
import { Term } from '../../models/term';
import { ProjectsState } from '../../stores/projects.state';
import { ClearMessages, CreateTerm, DeleteTerm, GetTerms, TermsState, UpdateTerm } from '../../stores/terms.state';
import { LabelTerm, UnlabelTerm, ProjectLabelState, GetProjectLabels } from '../../stores/project-label.state';
import { Label } from '../../models/label';
import { FormControl } from '@angular/forms';
import { ProjectTermsService } from '../../services/terms.service';

@Component({
  selector: 'app-terms-list',
  templateUrl: './terms-list.component.html',
  styleUrls: ['./terms-list.component.css'],
})
export class TermsListComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(TermsState.terms)
  projectTerms$: Observable<Term[]>;

  @Select(ProjectLabelState.labels)
  projectLabels$: Observable<Label[]>;

  @Select(state => state.terms.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.terms.errorMessage)
  errorMessage$: Observable<string | undefined>;

  newValue = '';

  labelFilterControl = new FormControl('');

  filteredTerms$: Observable<Term[]>;

  page = 0;
  pageSize = 10;

  searchText = new BehaviorSubject('');
  searchResults$: Observable<Term[]> = this.searchText.pipe(
    debounceTime(50),
    distinctUntilChanged(),
    map(search => search.trim().toLowerCase().split(' ')),
    switchMap(searchTerms =>
      this.projectTerms$.pipe(
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

            const context = r.context;

            for (const term of searchTerms) {
              if (context.indexOf(term) === -1) {
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

  searchKey = (item: Term) => {
    return [item.value, ...item.labels.map(v => v.value)].join('').toLowerCase();
  };

  constructor(
    private store: Store,
    private projectTermsService: ProjectTermsService,
  ) {}

  ngOnInit() {
    this.sub = this.project$
      .pipe(
        tap(project => {
          if (project) {
            this.filteredTerms$ = this.labelFilterControl.valueChanges.pipe(
              startWith(''),
              debounceTime(300),
              switchMap((selectedLabel: string) =>
                selectedLabel ? this.projectTermsService.fetchFilteredTerms(project.id, selectedLabel) : this.projectTerms$,
              ),
            );
          }
          this.store.dispatch(new GetTerms(project.id));
          this.store.dispatch(new GetProjectLabels(project.id));
        }),
      )
      .subscribe();
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
    this.store.dispatch(new ClearMessages());
  }

  onCreate(projectId: string, value: string) {
    if (!value) {
      return;
    }
    this.store.dispatch(new ClearMessages());
    this.store.dispatch(new CreateTerm(projectId, value));
  }

  updateTerm(projectId, termId, newValue, newContext) {
    this.store.dispatch(new UpdateTerm(projectId, termId, newValue, newContext));
  }

  deleteTerm(projectId, termId) {
    if (confirm('Are you sure that you want to delete this term?')) {
      this.store.dispatch(new DeleteTerm(projectId, termId));
    }
  }

  labelTerm(projectId, termId, label) {
    this.store.dispatch(new LabelTerm(projectId, label, termId));
  }

  unlabelTerm(projectId, termId, label) {
    this.store.dispatch(new UnlabelTerm(projectId, label, termId));
  }

  trackElement(index: number, term: Term) {
    return term.id;
  }
}
