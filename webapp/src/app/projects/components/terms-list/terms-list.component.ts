import { Component, OnDestroy, OnInit } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';
import { Project } from '../../models/project';
import { Term } from '../../models/term';
import { ProjectsState } from '../../stores/projects.state';
import { ClearMessages, CreateTerm, DeleteTerm, GetTerms, TermsState, UpdateTerm } from '../../stores/terms.state';
import { TagTerm, UntagTerm, ProjectTagState, GetProjectTags } from '../../stores/project-tag.state';
import { Tag } from '../../models/tag';

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

  @Select(ProjectTagState.tags)
  projectTags$: Observable<Tag[]>;

  @Select(state => state.terms.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.terms.errorMessage)
  errorMessage$: Observable<string | undefined>;

  newValue = '';

  page = 0;
  pageSize = 10;

  searchText = new BehaviorSubject('');
  searchResults$: Observable<Term[]> = this.searchText.pipe(
    debounceTime(50),
    distinctUntilChanged(),
    map(search =>
      search
        .trim()
        .toLowerCase()
        .split(' '),
    ),
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
            return true;
          });
        }),
      ),
    ),
  );

  private sub: Subscription;

  searchKey = (item: Term) => item.value;

  constructor(private store: Store) {}

  ngOnInit() {
    this.sub = this.project$
      .pipe(
        tap(project => {
          this.store.dispatch(new GetTerms(project.id));
          this.store.dispatch(new GetProjectTags(project.id));
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

  updateTerm(projectId, termId, newValue) {
    this.store.dispatch(new UpdateTerm(projectId, termId, newValue));
  }

  deleteTerm(projectId, termId) {
    if (confirm('Are you sure that you want to delete this term?')) {
      this.store.dispatch(new DeleteTerm(projectId, termId));
    }
  }

  tagTerm(projectId, termId, tag) {
    this.store.dispatch(new TagTerm(projectId, tag, termId));
  }

  untagTerm(projectId, termId, tag) {
    this.store.dispatch(new UntagTerm(projectId, tag, termId));
  }

  trackElement(index: number, term: Term) {
    return term.id;
  }
}
