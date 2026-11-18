import { TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { Subject } from 'rxjs';
import { Translation } from '../models/translation';
import { ProjectTranslationsService } from '../services/translations.service';
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
