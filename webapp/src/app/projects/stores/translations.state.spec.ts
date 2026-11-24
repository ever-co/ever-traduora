import { TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { Label } from '../models/label';
import { Term } from '../models/term';
import { Translation } from '../models/translation';
import { ProjectTermsService } from '../services/terms.service';
import { ProjectTranslationsService } from '../services/translations.service';
import { LabelTranslation } from './project-label.state';
import { TermsState } from './terms.state';
import { TranslationsState, UpdateTranslation } from './translations.state';

describe('TranslationsState saving a translation', () => {
  let store: Store;
  let request: Subject<Translation>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([TranslationsState])],
      providers: [{ provide: ProjectTranslationsService, useValue: { updateTranslation: () => (request = new Subject<Translation>()) } }],
    });
    store = TestBed.inject(Store);
    const state = store.snapshot();
    store.reset({ ...state, translations: { ...state.translations, translations: { de: [] } } });
  });

  const errorMessage = (): string | undefined => store.selectSnapshot(state => state.translations.errorMessage);

  const save = () => store.dispatch(new UpdateTranslation('p1', 'de', 't1', 'Hallo')).subscribe({ error: () => undefined });

  it('removes the error of a failed save while the next save runs, so a failure with the same message is announced again', () => {
    save();
    request.error({ status: 400 });
    const message = errorMessage();
    expect(message).toBeTruthy();

    save();
    expect(errorMessage()).withContext('the error of the first save is still shown while the retry runs').toBeUndefined();

    request.error({ status: 400 });
    expect(errorMessage()).toBe(message);
  });

  it('shows no error once a save succeeds after a failed one', () => {
    save();
    request.error({ status: 400 });

    save();
    request.next({ termId: 't1', value: 'Hallo', labels: [] });
    request.complete();

    expect(errorMessage()).toBeUndefined();
    expect(store.selectSnapshot(state => state.translations.translations.de)).toEqual([{ termId: 't1', value: 'Hallo', labels: [] }]);
  });
});

describe('TranslationsState labelling a translation', () => {
  const todo: Label = { id: 'l1', value: 'todo', color: '#202020' };
  const done: Label = { id: 'l2', value: 'done', color: '#808080' };
  let store: Store;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([TranslationsState, TermsState])],
      providers: [
        { provide: ProjectTranslationsService, useValue: {} },
        { provide: ProjectTermsService, useValue: {} },
      ],
    });
    store = TestBed.inject(Store);
    const state = store.snapshot();
    const de: Translation[] = [{ termId: 't1', value: 'Hallo', labels: [done] }];
    const terms: Term[] = [
      { id: 't1', value: 'greeting', context: null, labels: [] },
      { id: 't2', value: 'farewell', context: null, labels: [] },
      { id: 't3', value: 'thanks', context: null, labels: [done] },
    ];
    store.reset({ ...state, translations: { ...state.translations, translations: { de } }, terms: { ...state.terms, terms } });
  });

  const forLocale = (localeCode: string): Translation[] => store.selectSnapshot(state => state.translations.translations[localeCode]);

  it('adds the label to the translation of the term', () => {
    store.dispatch(new LabelTranslation('p1', todo, 't1', 'de'));

    expect(forLocale('de')).toEqual([{ termId: 't1', value: 'Hallo', labels: [done, todo] }]);
  });

  it('adds a translation with the label for a term that has none in the locale yet, as an imported term in another locale', () => {
    store.dispatch(new LabelTranslation('p1', todo, 't2', 'de'));

    expect(forLocale('de')).toEqual([
      { termId: 't1', value: 'Hallo', labels: [done] },
      { termId: 't2', value: '', labels: [todo] },
    ]);
  });

  it('gives that translation the labels of the term too, as the API does', () => {
    store.dispatch(new LabelTranslation('p1', todo, 't3', 'de'));

    expect(forLocale('de')[1]).toEqual({ termId: 't3', value: '', labels: [done, todo] });
  });

  it('leaves a locale that is not loaded alone', () => {
    store.dispatch(new LabelTranslation('p1', todo, 't1', 'fr'));

    expect(forLocale('fr')).toBeUndefined();
    expect(forLocale('de')).toEqual([{ termId: 't1', value: 'Hallo', labels: [done] }]);
  });
});
