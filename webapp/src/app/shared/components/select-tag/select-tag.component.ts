import { Component, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import { BehaviorSubject, merge, Observable, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { Tag } from '../../../projects/models/tag';

@Component({
  selector: 'app-select-tag',
  templateUrl: './select-tag.component.html',
  styleUrls: ['./select-tag.component.css'],
})
export class SelectTagComponent implements OnInit, OnChanges {
  @Input()
  tags: Tag[] = [];

  @Input()
  exclude: Tag[] = [];

  @Input()
  limit = 25;

  @Input()
  loading = false;

  @Input()
  preserveHeight = false;

  @Output()
  selectTag = new EventEmitter<Tag>();

  selection: Tag | undefined;

  text$ = new BehaviorSubject<string>('');

  private ngChanged$ = new Subject<string>();
  private debouncedText$ = this.text$.pipe(
    debounceTime(50),
    map(text => text.trim().toLowerCase()),
    distinctUntilChanged(),
  );

  results$: Observable<Tag[]> = merge(this.debouncedText$, this.ngChanged$).pipe(
    map(text => {
      if (text === '') {
        return this.defaultTags();
      }

      const tokens = text.toLowerCase().split(' ');

      return this.availableTags()
        .filter(tag => {
          const searchString = this.tagToSearchString(tag);
          for (const token of tokens) {
            if (searchString.indexOf(token) === -1) {
              return false;
            }
          }
          return true;
        })
        .slice(0, this.limit);
    }),
  );

  constructor() {}

  ngOnInit() {}

  ngOnChanges() {
    this.ngChanged$.next(this.text$.getValue());
  }

  select(tag: Tag) {
    this.selection = tag;
    this.selectTag.emit(tag);
  }

  defaultTags(): Tag[] {
    const all = this.availableTags();
    if (all.length < this.limit) {
      return all.slice(0, this.limit);
    }
    return all.slice(0, this.limit);
  }

  availableTags() {
    return this.tags.filter(v => !this.exclude.map(x => x.id).includes(v.id));
  }

  tagToSearchString(tag: Tag): string {
    return tag.value.toLowerCase();
  }
}
