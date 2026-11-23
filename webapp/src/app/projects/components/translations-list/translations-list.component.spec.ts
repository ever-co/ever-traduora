import { HttpErrorResponse } from '@angular/common/http';
import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, ParamMap, Router } from '@angular/router';
import { NgbPaginationModule } from '@ng-bootstrap/ng-bootstrap';
import { NgxsModule, Store } from '@ngxs/store';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { EditableTextComponent } from '../../../shared/components/editable-text/editable-text.component';
import { ErrorMessageComponent } from '../../../shared/components/error-message/error-message.component';
import { SearchComponent } from '../../../shared/components/search/search.component';
import { ClipboardService } from '../../../shared/services/clipboard.service';
import { Label } from '../../models/label';
import { Locale } from '../../models/locale';
import { ProjectLabelService } from '../../services/project-label.service';
import { ProjectTermsService } from '../../services/terms.service';
import { ProjectTranslationsService } from '../../services/translations.service';
import { ProjectLabelState } from '../../stores/project-label.state';
import { TermsState } from '../../stores/terms.state';
import { GetTranslations, TranslationsState } from '../../stores/translations.state';
import { TranslationsListComponent } from './translations-list.component';

@Pipe({ name: 'can' })
class AllowAllPipe implements PipeTransform {
  transform() {
    return of(true);
  }
}

describe('TranslationsListComponent', () => {
  const en: Locale = { code: 'en', language: 'English', region: '' };
  const de: Locale = { code: 'de', language: 'German', region: '' };
  const fr: Locale = { code: 'fr', language: 'French', region: '' };
  const todo: Label = { id: 'l1', value: 'todo', color: '#202020' };
  const noLabelsState = { labels: [], isLoading: false, errorMessage: undefined };
  const mainButton = 'button[aria-label="Copy translation to clipboard"]';
  const refButton = 'button[aria-label="Copy reference translation to clipboard"]';

  let fixture: ComponentFixture<TranslationsListComponent>;
  let copy: jasmine.Spy;
  let referenceLocale: BehaviorSubject<Locale | undefined>;
  let params: BehaviorSubject<ParamMap>;
  let translationsService: jasmine.SpyObj<ProjectTranslationsService>;
  let labelService: jasmine.SpyObj<ProjectLabelService>;

  // The store selections are replaced with fixed data, so the real template renders one card.
  // With a store state given, the error message is read from the store instead.
  // The translations, terms and labels stores run for real, against services that answer without a server.
  const render = (storeState?: object) => {
    copy = jasmine.createSpy('copy').and.returnValue(Promise.resolve(true));
    params = new BehaviorSubject(convertToParamMap({ localeCode: 'en' }));
    translationsService = jasmine.createSpyObj<ProjectTranslationsService>('ProjectTranslationsService', {
      loadKnownLocales: of([]),
      findProjectLocales: of([]),
      findProjectTranslation: of([]),
      // A test that saves sets the answer
      updateTranslation: undefined,
    });
    labelService = jasmine.createSpyObj<ProjectLabelService>('ProjectLabelService', {
      find: of([]),
      // A test that labels a translation sets the answer
      labelTranslation: undefined,
      unlabelTranslation: undefined,
    });
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([TranslationsState, TermsState, ProjectLabelState]), NgbPaginationModule, AllowAllPipe],
      declarations: [TranslationsListComponent, SearchComponent, EditableTextComponent, ErrorMessageComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        // A route whose locale can change in place, as when another locale is picked on the page
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: Router, useValue: {} },
        { provide: ClipboardService, useValue: { copy } },
        { provide: ProjectTranslationsService, useValue: translationsService },
        { provide: ProjectTermsService, useValue: { find: () => of([]) } },
        { provide: ProjectLabelService, useValue: labelService },
      ],
    });
    if (storeState) {
      TestBed.inject(Store).reset({ projectLabels: noLabelsState, ...storeState });
    }
    fixture = TestBed.createComponent(TranslationsListComponent);
    const component = fixture.componentInstance;
    const select = (key: string, value: unknown) => Object.defineProperty(component, key, { value: of(value), configurable: true });
    select('project$', { id: 'p1' });
    select('knownLocales$', [en, de, fr]);
    select('projectLocales$', [{ locale: en }, { locale: de }, { locale: fr }]);
    select('isLoading$', false);
    if (!storeState) {
      select('errorMessage$', undefined);
    }
    select('projectLabels$', []);
    referenceLocale = new BehaviorSubject<Locale | undefined>(de);
    component.currentLocale$ = of(en);
    component.referenceLocale$ = referenceLocale.asObservable();
    component.translations$ = of([
      { term: { id: 't1', value: 'greeting', context: null, labels: [] }, translation: undefined, labels: [], value: 'Hello', valueRef: 'Hallo' },
    ]);
    fixture.detectChanges();
    // The search box debounces its results
    tick(100);
    fixture.detectChanges();
  };

  const click = (selector: string) => {
    fixture.nativeElement.querySelector(selector).click();
    flushMicrotasks();
    fixture.detectChanges();
  };

  const errorMessage = (): string | undefined => fixture.nativeElement.querySelector('app-error-message p')?.textContent.trim();

  // Angular keeps the component when only the locale of the route changes
  const pickLocale = (localeCode: string) => {
    params.next(convertToParamMap({ localeCode }));
    fixture.detectChanges();
  };

  const statuses = (): string[] => Array.from(fixture.nativeElement.querySelectorAll('[role="status"]')).map((s: Element) => s.textContent.trim());

  it('shows the error of a translation the API refused to save', fakeAsync(() => {
    // UpdateTranslation writes its error to the translations store, not to the terms one
    render({ translations: { errorMessage: 'Bad request' }, terms: {} });

    expect(errorMessage()).toBe('Bad request');
    fixture.destroy();
  }));

  it('still shows an error of the terms store', fakeAsync(() => {
    render({ translations: {}, terms: { errorMessage: 'Error, resource not found' } });

    expect(errorMessage()).toBe('Error, resource not found');
    fixture.destroy();
  }));

  it('drops the save error of the previous locale when another locale is picked', fakeAsync(() => {
    render({ translations: { errorMessage: 'Bad request' }, terms: {} });
    expect(errorMessage()).toBe('Bad request');

    pickLocale('fr');

    expect(translationsService.findProjectTranslation).toHaveBeenCalledWith('p1', 'fr');
    expect(errorMessage()).toBeUndefined();
    fixture.destroy();
  }));

  it('shows the error of the picked locale when it fails to load', fakeAsync(() => {
    render({ translations: { errorMessage: 'Bad request' }, terms: {} });
    translationsService.findProjectTranslation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 403 })));

    pickLocale('fr');

    expect(errorMessage()).toBe('There was an error while loading, please refresh the page.');
    fixture.destroy();
  }));

  it('shows the error of a save that fails in the picked locale', fakeAsync(() => {
    render({ translations: { errorMessage: 'Bad request' }, terms: {} });
    pickLocale('fr');
    translationsService.updateTranslation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 422 })));

    fixture.componentInstance.updateTranslation('p1', 'fr', 't1', 'Bonjour');
    fixture.detectChanges();

    expect(translationsService.updateTranslation).toHaveBeenCalledWith('p1', 'fr', 't1', 'Bonjour');
    expect(errorMessage()).toBe('The server was unable to process the request, please check your request.');
    fixture.destroy();
  }));

  it('keeps an error of the terms store when another locale is picked', fakeAsync(() => {
    // The terms are the same in every locale, so their error does not belong to the previous one
    render({ translations: {}, terms: { errorMessage: 'Error, resource not found' } });

    pickLocale('fr');

    expect(errorMessage()).toBe('Error, resource not found');
    fixture.destroy();
  }));

  it('shows the error of a label the API refused to add to a translation', fakeAsync(() => {
    // LabelTranslation writes its error to the labels store; the dialog that picked the label is already closed
    render({ translations: {}, terms: {} });
    labelService.labelTranslation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    fixture.componentInstance.labelTranslation('p1', 't1', todo, 'en');
    fixture.detectChanges();

    expect(labelService.labelTranslation).toHaveBeenCalledWith('p1', 'l1', 't1', 'en');
    expect(errorMessage()).toBe('Error, resource not found');
    fixture.destroy();
  }));

  it('loads the locale again when a label fails, so the label that was not added does not show', fakeAsync(() => {
    render({ translations: {}, terms: {} });
    labelService.labelTranslation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    translationsService.findProjectTranslation.calls.reset();

    // t1 has no translation in en yet: the list adds it with the label before the API answers
    fixture.componentInstance.labelTranslation('p1', 't1', todo, 'en');

    expect(translationsService.findProjectTranslation).toHaveBeenCalledOnceWith('p1', 'en');
    expect(TestBed.inject(Store).selectSnapshot(state => state.translations.translations.en)).toEqual([]);
    fixture.destroy();
  }));

  it('loads the locale again when removing a label fails, so the label shows again', fakeAsync(() => {
    const labelled = [{ termId: 't1', value: 'Hello', labels: [todo] }];
    render({ translations: {}, terms: {} });
    const store = TestBed.inject(Store);
    translationsService.findProjectTranslation.and.returnValue(of(labelled));
    store.dispatch(new GetTranslations('p1', 'en'));
    translationsService.findProjectTranslation.calls.reset();
    labelService.unlabelTranslation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));

    // The list removes the label before the API answers
    fixture.componentInstance.unlabelTranslation('p1', 't1', todo, 'en');

    expect(translationsService.findProjectTranslation).toHaveBeenCalledOnceWith('p1', 'en');
    expect(store.selectSnapshot(state => state.translations.translations.en)).toEqual(labelled);
    fixture.destroy();
  }));

  // A label added on this page fails, so its error shows
  const failLabel = () => {
    labelService.labelTranslation.and.returnValue(throwError(() => new HttpErrorResponse({ status: 404 })));
    fixture.componentInstance.labelTranslation('p1', 't1', todo, 'en');
    fixture.detectChanges();
    expect(errorMessage()).toBe('Error, resource not found');
  };

  it('does not show a label error that another page left in the store, as a failed term label on the Terms page', fakeAsync(() => {
    render({ translations: {}, terms: {}, projectLabels: { ...noLabelsState, errorMessage: 'Error, resource not found' } });

    expect(errorMessage()).toBeUndefined();
    fixture.destroy();
  }));

  it('removes the error of a failed label once a label is added', fakeAsync(() => {
    render({ translations: {}, terms: {} });
    failLabel();
    labelService.labelTranslation.and.returnValue(of(undefined));

    fixture.componentInstance.labelTranslation('p1', 't1', todo, 'en');
    fixture.detectChanges();

    expect(errorMessage()).toBeUndefined();
    fixture.destroy();
  }));

  it('drops the label error of the previous locale when another locale is picked, and when the page is left', fakeAsync(() => {
    render({ translations: {}, terms: {} });
    failLabel();

    pickLocale('fr');
    expect(errorMessage()).toBeUndefined();

    const store = TestBed.inject(Store);
    store.reset({ ...store.snapshot(), projectLabels: { ...noLabelsState, errorMessage: 'Error, resource not found' } });
    fixture.destroy();
    expect(store.selectSnapshot(state => state.projectLabels.errorMessage)).toBeUndefined();
  }));

  it('renders a labelled copy button and a status region for both cells', fakeAsync(() => {
    render();

    for (const selector of [mainButton, refButton]) {
      const button: HTMLButtonElement = fixture.nativeElement.querySelector(selector);
      expect(button).not.toBeNull();
      expect(button.getAttribute('type')).toBe('button');
      expect(button.querySelector('i').getAttribute('aria-hidden')).toBe('true');
    }
    expect(statuses()).toEqual(['', '']);
    fixture.destroy();
  }));

  it('copies the main value and shows Copied for two seconds without opening the editor', fakeAsync(() => {
    render();

    click(mainButton);

    expect(copy).toHaveBeenCalledWith('Hello');
    expect(statuses()).toEqual(['Copied', '']);
    expect(fixture.nativeElement.querySelector('textarea.is-editing')).toBeNull();
    tick(1999);
    fixture.detectChanges();
    expect(statuses()).toEqual(['Copied', '']);
    tick(1);
    fixture.detectChanges();
    expect(statuses()).toEqual(['', '']);
    fixture.destroy();
  }));

  it('copies the reference value, and the confirmation does not follow a locale change', fakeAsync(() => {
    render();

    click(refButton);
    expect(copy).toHaveBeenCalledWith('Hallo');
    expect(statuses()).toEqual(['', 'Copied']);

    referenceLocale.next(fr);
    fixture.detectChanges();
    expect(statuses()).toEqual(['', '']);
    fixture.destroy();
  }));

  it('shows nothing when the copy fails', fakeAsync(() => {
    render();
    copy.and.returnValue(Promise.resolve(false));

    click(mainButton);

    expect(statuses()).toEqual(['', '']);
    fixture.destroy();
  }));

  it('leaves no timer behind when the page is left', fakeAsync(() => {
    render();
    click(mainButton);

    // fakeAsync fails the test if the two-second timer is still queued
    fixture.destroy();
    expect(fixture.componentInstance.copiedCell).toBe('main:en:t1');
  }));

  it('starts no timer when the page is left while the copy is still running', fakeAsync(() => {
    render();
    let finishCopy: (ok: boolean) => void;
    copy.and.returnValue(new Promise<boolean>(resolve => (finishCopy = resolve)));
    fixture.nativeElement.querySelector(mainButton).click();

    fixture.destroy();
    finishCopy(true);
    flushMicrotasks();

    expect(fixture.componentInstance.copiedCell).toBeUndefined();
  }));
});
