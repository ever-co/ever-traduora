import { Component, ContentChild, Input, OnInit, TemplateRef } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { debounceTime, distinctUntilChanged, mergeMap, map } from 'rxjs/operators';

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css'],
})
export class SearchComponent implements OnInit {
  @Input()
  items: Observable<any[]>;

  @Input()
  key: (item: any) => string;

  @Input()
  trackBy: (item: any) => any;

  @Input()
  pageSize = 10;

  @Input()
  placeholder = 'Search...';

  @ContentChild('searchResultsHeader')
  searchResultsHeader: TemplateRef<any>;

  @ContentChild('searchResultsItem')
  searchResultsItem: TemplateRef<any>;

  page = 0;

  searchText = new BehaviorSubject('');
  searchResults$: Observable<any[]> = this.searchText.pipe(
    debounceTime(50),
    distinctUntilChanged(),
    map(search => search.trim().toLowerCase().split(' ')),
    mergeMap(searchTerms =>
      this.items.pipe(
        map(items => {
          if (searchTerms.length === 0) {
            return items;
          }
          return items.filter(item => {
            const value = this.key(item).toLowerCase();
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

  searchResultsSize$ = this.searchResults$.pipe(map(results => (results ? results.length : 0)));

  constructor() {}

  ngOnInit() {}
}
