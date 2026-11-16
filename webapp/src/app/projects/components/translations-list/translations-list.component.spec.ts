import { NO_ERRORS_SCHEMA, Pipe, PipeTransform } from '@angular/core';
import { ComponentFixture, fakeAsync, flushMicrotasks, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { NgbPaginationModule } from '@ng-bootstrap/ng-bootstrap';
import { NgxsModule } from '@ngxs/store';
import { BehaviorSubject, of } from 'rxjs';
import { EditableTextComponent } from '../../../shared/components/editable-text/editable-text.component';
import { SearchComponent } from '../../../shared/components/search/search.component';
import { ClipboardService } from '../../../shared/services/clipboard.service';
import { Locale } from '../../models/locale';
import { TranslationsListComponent } from './translations-list.component';

@Pipe({ name: 'can' })
class AllowAllPipe implements PipeTransform {
  transform() {
    return of(true);
  }
}

describe('TranslationsListComponent copy buttons', () => {
  const en: Locale = { code: 'en', language: 'English', region: '' };
  const de: Locale = { code: 'de', language: 'German', region: '' };
  const fr: Locale = { code: 'fr', language: 'French', region: '' };
  const mainButton = 'button[aria-label="Copy translation to clipboard"]';
  const refButton = 'button[aria-label="Copy reference translation to clipboard"]';

  let fixture: ComponentFixture<TranslationsListComponent>;
  let copy: jasmine.Spy;
  let referenceLocale: BehaviorSubject<Locale | undefined>;

  // The store selections are replaced with fixed data, so the real template renders one card
  const render = () => {
    copy = jasmine.createSpy('copy').and.returnValue(Promise.resolve(true));
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([]), NgbPaginationModule, AllowAllPipe],
      declarations: [TranslationsListComponent, SearchComponent, EditableTextComponent],
      schemas: [NO_ERRORS_SCHEMA],
      providers: [
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ localeCode: 'en' })) } },
        { provide: Router, useValue: {} },
        { provide: ClipboardService, useValue: { copy } },
      ],
    });
    fixture = TestBed.createComponent(TranslationsListComponent);
    const component = fixture.componentInstance;
    const select = (key: string, value: unknown) => Object.defineProperty(component, key, { value: of(value), configurable: true });
    select('project$', { id: 'p1' });
    select('knownLocales$', [en, de, fr]);
    select('projectLocales$', [{ locale: en }, { locale: de }, { locale: fr }]);
    select('isLoading$', false);
    select('errorMessage$', undefined);
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

  const statuses = (): string[] => Array.from(fixture.nativeElement.querySelectorAll('[role="status"]')).map((s: Element) => s.textContent.trim());

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
