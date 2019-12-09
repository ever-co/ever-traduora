import { Component, OnDestroy, OnInit } from '@angular/core';
import { Select, Store } from '@ngxs/store';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged, map, switchMap, tap } from 'rxjs/operators';
import { Project } from '../../models/project';
import { Tag } from '../../models/tag';
import { ClearMessages, CreateProjectTag, GetProjectTags, ProjectTagState, RemoveProjectTag, UpdateProjectTag } from '../../stores/project-tag.state';
import { ProjectsState } from '../../stores/projects.state';

@Component({
  selector: 'app-tags-list',
  templateUrl: './tags-list.component.html',
  styleUrls: ['./tags-list.component.css'],
})
export class TagsListComponent implements OnInit, OnDestroy {
  @Select(ProjectsState.currentProject)
  project$: Observable<Project | undefined>;

  @Select(ProjectTagState.tags)
  projectTags$: Observable<Tag[]>;

  @Select(ProjectTagState.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.projectTags.errorMessage)
  errorMessage$: Observable<string | undefined>;

  newValue = '';

  page = 0;
  pageSize = 10;

  searchText = new BehaviorSubject('');
  searchResults$: Observable<Tag[]> = this.searchText.pipe(
    debounceTime(50),
    distinctUntilChanged(),
    map(search =>
      search
        .trim()
        .toLowerCase()
        .split(' '),
    ),
    switchMap(searchTerms =>
      this.projectTags$.pipe(
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

  searchKey = (item: Tag) => item.value;

  constructor(private store: Store) {}

  ngOnInit() {
    this.sub = this.project$.pipe(tap(project => this.store.dispatch(new GetProjectTags(project.id)))).subscribe();
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
    this.store.dispatch(new CreateProjectTag(projectId, value, color));
  }

  updateTag(projectId, tagId, newValue, newColor) {
    this.store.dispatch(new UpdateProjectTag(projectId, tagId, newValue, newColor));
  }

  deleteTag(projectId, tagId) {
    if (confirm('Are you sure that you want to delete this tag?')) {
      this.store.dispatch(new RemoveProjectTag(projectId, tagId));
    }
  }

  trackElement(index: number, tag: Tag) {
    return tag.id;
  }
}
