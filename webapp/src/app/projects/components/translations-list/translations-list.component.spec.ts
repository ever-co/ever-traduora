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
import { Locale } from '../../models/locale';
import { ProjectTermsService } from '../../services/terms.service';
import { ProjectTranslationsService } from '../../services/translations.service';
import { TermsState } from '../../stores/terms.state';
import { TranslationsState } from '../../stores/translations.state';
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
  const mainButton = 'button[aria-label="Copy translation to clipboard"]';
  const refButton = 'button[aria-label="Copy reference translation to clipboard"]';

  let fixture: ComponentFixture<TranslationsListComponent>;
  let copy: jasmine.Spy;
  let referenceLocale: BehaviorSubject<Locale | undefined>;
  let params: BehaviorSubject<ParamMap>;
  let translationsService: jasmine.SpyObj<ProjectTranslationsService>;

  // The store selections are replaced with fixed data, so the real template renders one card.
  // With a store state given, the error message is read from the store instead.
  // The translations and terms stores run for real, against services that answer without a server.
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
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([TranslationsState, TermsState]), NgbPaginationModule, AllowAllPipe],
      declarations: [TranslationsListComponent, SearchComponent, EditableTextComponent, ErrorMessageComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        // A route whose locale can change in place, as when another locale is picked on the page
        { provide: ActivatedRoute, useValue: { paramMap: params.asObservable() } },
        { provide: Router, useValue: {} },
        { provide: ClipboardService, useValue: { copy } },
        { provide: ProjectTranslationsService, useValue: translationsService },
        { provide: ProjectTermsService, useValue: { find: () => of([]) } },
      ],
    });
    if (storeState) {
      TestBed.inject(Store).reset(storeState);
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

  const fields = (): string[] => Array.from(fixture.nativeElement.querySelectorAll('textarea')).map((t: HTMLTextAreaElement) => t.value);
  const saveButtons = (): HTMLButtonElement[] => Array.from(fixture.nativeElement.querySelectorAll('button[aria-label="Save"]'));

  // Types in the main (0) or the reference (1) field, as a keyboard user who tabbed to it
  const typeIn = (index: number, text: string) => {
    const field: HTMLTextAreaElement = fixture.nativeElement.querySelectorAll('textarea')[index];
    field.dispatchEvent(new Event('focus'));
    field.value = text;
    field.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  };

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

  it('does not save a text typed in one locale to the locale picked after it', fakeAsync(() => {
    render();
    const component = fixture.componentInstance;
    const update = spyOn(component, 'updateTranslation');
    typeIn(0, 'Hello world');
    expect(saveButtons().length).toBe(1);

    // The same card now shows the term in French, here with the same text as in English
    component.currentLocale$ = of(fr);
    fixture.detectChanges();

    expect(fields()).toEqual(['Hello', 'Hallo']);
    expect(saveButtons().length).toBe(0);
    typeIn(0, 'Bonjour');
    saveButtons()[0].click();
    expect(update).toHaveBeenCalledOnceWith('p1', 'fr', 't1', 'Bonjour');
    fixture.destroy();
  }));

  it('does not save a text typed in the reference locale to the reference locale picked after it', fakeAsync(() => {
    render();
    const update = spyOn(fixture.componentInstance, 'updateTranslation');
    typeIn(1, 'Hallo Welt');

    referenceLocale.next(fr);
    fixture.detectChanges();

    expect(fields()).toEqual(['Hello', 'Hallo']);
    expect(saveButtons().length).toBe(0);
    expect(update).not.toHaveBeenCalled();
    fixture.destroy();
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
