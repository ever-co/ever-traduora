import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Locale } from '../../../projects/models/locale';
import { SelectLocaleComponent } from './select-locale.component';

describe('SelectLocaleComponent', () => {
  const locales: Locale[] = [
    { code: 'de_DE', language: 'German', region: 'Germany' },
    { code: 'en_US', language: 'English', region: 'United States' },
  ];

  const render = (): ComponentFixture<SelectLocaleComponent> => {
    TestBed.configureTestingModule({ declarations: [SelectLocaleComponent], schemas: [NO_ERRORS_SCHEMA] });
    const fixture = TestBed.createComponent(SelectLocaleComponent);
    fixture.componentInstance.locales = locales;
    fixture.detectChanges();
    return fixture;
  };

  const options = (fixture: ComponentFixture<SelectLocaleComponent>): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.list-group-item-action'));

  it('renders each locale as a button that the keyboard can reach', () => {
    const items = options(render());

    expect(items.length).toBe(2);
    for (const item of items) {
      expect(item.tagName).toBe('BUTTON');
      expect(item.getAttribute('type')).toBe('button');
      expect(item.tabIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('emits the chosen locale and marks only its option as pressed', () => {
    const fixture = render();
    const emitted: Locale[] = [];
    fixture.componentInstance.selectLocale.subscribe((l: Locale) => emitted.push(l));

    options(fixture)[1].click();
    fixture.detectChanges();

    expect(emitted).toEqual([locales[1]]);
    const [first, second] = options(fixture);
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(first.getAttribute('aria-pressed')).toBe('false');
  });

  it('names the search input', () => {
    const input: HTMLInputElement = render().nativeElement.querySelector('input#localeSearch');

    expect(input.getAttribute('aria-label')).toBe('Search locales');
  });
});
