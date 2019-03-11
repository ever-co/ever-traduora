import { Component, EventEmitter, Input, OnChanges, OnInit, Output } from '@angular/core';
import { BehaviorSubject, merge, Observable, Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged, map } from 'rxjs/operators';
import { Locale } from '../../../projects/models/locale';

@Component({
  selector: 'app-select-locale',
  templateUrl: './select-locale.component.html',
  styleUrls: ['./select-locale.component.css'],
})
export class SelectLocaleComponent implements OnInit, OnChanges {
  @Input()
  locales: Locale[] = [];

  @Input()
  exclude: Locale[] = [];

  @Input()
  limit = 5;

  @Input()
  loading = false;

  @Input()
  preserveHeight = false;

  @Output()
  selectLocale = new EventEmitter<Locale>();

  selection: Locale | undefined;

  text$ = new BehaviorSubject<string>('');

  private ngChanged$ = new Subject<string>();
  private debouncedText$ = this.text$.pipe(
    debounceTime(50),
    map(text => text.trim().toLowerCase()),
    distinctUntilChanged(),
  );

  results$: Observable<Locale[]> = merge(this.debouncedText$, this.ngChanged$).pipe(
    map(text => {
      if (text === '') {
        return this.defaultLocales();
      }

      const tokens = text.toLowerCase().split(' ');

      return this.availableLocales()
        .filter(locale => {
          const localeSearchString = this.localeToSearchString(locale);
          for (const token of tokens) {
            if (localeSearchString.indexOf(token) === -1) {
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

  select(locale: Locale) {
    this.selection = locale;
    this.selectLocale.emit(locale);
  }

  defaultLocales(): Locale[] {
    const all = this.availableLocales();
    const res = all.filter(locale => locale.code.startsWith('de_') || locale.code.startsWith('en_'));
    if (res.length < this.limit) {
      return all.slice(0, this.limit);
    }
    return res.slice(0, this.limit);
  }

  availableLocales() {
    return this.locales.filter(v => !this.exclude.map(x => x.code).includes(v.code));
  }

  localeToSearchString(locale: Locale): string {
    return `${locale.language} ${locale.region} ${locale.code}`.toLowerCase();
  }
}
