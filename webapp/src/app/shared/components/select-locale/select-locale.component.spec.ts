import { Component, NO_ERRORS_SCHEMA } from '@angular/core';
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
    const input: HTMLInputElement = render().nativeElement.querySelector('input');

    expect(input.getAttribute('aria-label')).toBe('Search locales');
  });

  it('names the list of locales', () => {
    const list: HTMLElement = render().nativeElement.querySelector('.list-group');

    expect(list.getAttribute('role')).toBe('group');
    expect(list.getAttribute('aria-label')).toBe('Locales');
  });

  it('hides the decorative search icon from assistive tech', () => {
    const icon: HTMLElement = render().nativeElement.querySelector('.input-group-text i.material-icons');

    expect(icon.getAttribute('aria-hidden')).toBe('true');
  });

  describe('two pickers on one page', () => {
    @Component({
      standalone: false,
      template: `
        <app-select-locale [locales]="locales" searchLabel="Search the first locale" listLabel="First locale"></app-select-locale>
        <app-select-locale [locales]="locales" searchLabel="Search the second locale" listLabel="Second locale"></app-select-locale>
      `,
    })
    class TwoPickersComponent {
      locales = locales;
    }

    const renderTwo = (): HTMLElement => {
      TestBed.configureTestingModule({ declarations: [SelectLocaleComponent, TwoPickersComponent], schemas: [NO_ERRORS_SCHEMA] });
      const fixture = TestBed.createComponent(TwoPickersComponent);
      fixture.detectChanges();
      return fixture.nativeElement;
    };

    it('gives each search input its own name and no shared id', () => {
      const [first, second] = Array.from(renderTwo().querySelectorAll('input')) as HTMLInputElement[];

      expect(first.getAttribute('aria-label')).toBe('Search the first locale');
      expect(second.getAttribute('aria-label')).toBe('Search the second locale');
      expect(first.id).toBeTruthy();
      expect(second.id).toBeTruthy();
      expect(first.id).not.toBe(second.id);
      expect(first.name).not.toBe(second.name);
    });

    it('gives each list of locales its own name', () => {
      const [first, second] = Array.from(renderTwo().querySelectorAll('.list-group')) as HTMLElement[];

      expect(first.getAttribute('role')).toBe('group');
      expect(first.getAttribute('aria-label')).toBe('First locale');
      expect(second.getAttribute('role')).toBe('group');
      expect(second.getAttribute('aria-label')).toBe('Second locale');
    });
  });
});
