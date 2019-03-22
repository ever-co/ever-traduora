import { Observable, BehaviorSubject, Subject, of } from 'rxjs';
import { map, switchMap, tap } from 'rxjs/operators';

interface TranslationStore {
  load(locale: string): Observable<LocaleTranslations>;
  availableLocales(): Observable<string>;
}

interface TraduoraConfig {
  apiKey: string;
  apiSecret: string;
}

class Traduora implements TranslationStore {
  constructor(private config: TraduoraConfig) {}

  load(locale: string): Observable<{ [term: string]: string }> {
    throw new Error('Method not implemented.');
  }

  availableLocales(): Observable<string> {
    throw new Error('Method not implemented.');
  }
}

interface TranslationsConfig {
  defaultLocale: string;
  store: TranslationStore;
}

type LocaleTranslations = { [term: string]: string };

class Translations {
  private cache: { [locale: string]: Observable<LocaleTranslations> };
  private locale: Subject<string>;
  private store: TranslationStore;

  constructor(config: TranslationsConfig) {
    this.locale = new BehaviorSubject(config.defaultLocale);
    this.store = config.store;
  }

  availableLocales(): Observable<string> {
    return this.store.availableLocales();
  }

  getCurrentLocale(): Observable<string> {
    return this.locale.asObservable();
  }

  setCurrentLocale(locale: string): void {
    this.locale.next(locale);
  }

  get(term: string, defaultValue: string): Observable<string> {
    return this.locale.pipe(
      switchMap(locale => {
        let cached = this.cache[locale];
        if (!cached) {
          // Store subject in cache to avoid further calls to get to also trigger the load
          const sub = new Subject<LocaleTranslations>();
          this.cache[locale] = sub.asObservable();
          return this.store.load(locale).pipe(tap(result => sub.next(result)));
        }
        return cached;
      }),
      map(translations => translations[term] || defaultValue),
    );
  }
}
