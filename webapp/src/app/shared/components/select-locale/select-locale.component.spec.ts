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

  // The name assistive tech reads: aria-label wins over a linked <label>.
  const accessibleName = (input: HTMLInputElement): string =>
    input.getAttribute('aria-label') || Array.from(input.labels || [], label => label.textContent.trim()).join(' ');

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

  describe('with a visible label', () => {
    const renderLabelled = (pickerLocales: Locale[] = locales): HTMLElement => {
      TestBed.configureTestingModule({ declarations: [SelectLocaleComponent], schemas: [NO_ERRORS_SCHEMA] });
      const fixture = TestBed.createComponent(SelectLocaleComponent);
      fixture.componentInstance.locales = pickerLocales;
      fixture.componentRef.setInput('label', 'Select a locale');
      fixture.detectChanges();
      return fixture.nativeElement;
    };

    it('renders the label and points its for at the search input', () => {
      const element = renderLabelled();
      const label: HTMLLabelElement = element.querySelector('label');
      const input: HTMLInputElement = element.querySelector('input');

      expect(label).withContext('no <label> rendered').not.toBeNull();
      expect(label.textContent.trim()).toBe('Select a locale');
      expect(input.id).toBeTruthy();
      expect(label.htmlFor).toBe(input.id);
    });

    it('names the search input by its visible label instead of a hidden aria-label', () => {
      const input: HTMLInputElement = renderLabelled().querySelector('input');

      expect(input.hasAttribute('aria-label')).toBeFalse();
      expect(accessibleName(input).startsWith('Select a locale')).withContext(accessibleName(input)).toBeTrue();
    });

    it('keeps the label but points it at nothing when no locale is left to search', () => {
      const element = renderLabelled([]);
      const label: HTMLLabelElement = element.querySelector('label');

      expect(element.querySelector('input')).toBeNull();
      expect(label).withContext('no <label> rendered').not.toBeNull();
      expect(label.textContent.trim()).toBe('Select a locale');
      expect(label.hasAttribute('for')).toBeFalse();
    });
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

  describe('two labelled pickers on one page', () => {
    @Component({
      standalone: false,
      template: `
        <app-select-locale [locales]="locales" label="Select the first locale"></app-select-locale>
        <app-select-locale [locales]="locales" label="Select the second locale"></app-select-locale>
      `,
    })
    class TwoLabelledPickersComponent {
      locales = locales;
    }

    it('links each visible label to its own search input', () => {
      TestBed.configureTestingModule({ declarations: [SelectLocaleComponent, TwoLabelledPickersComponent], schemas: [NO_ERRORS_SCHEMA] });
      const fixture = TestBed.createComponent(TwoLabelledPickersComponent);
      fixture.detectChanges();
      const element: HTMLElement = fixture.nativeElement;
      const labels = Array.from(element.querySelectorAll('label')) as HTMLLabelElement[];
      const inputs = Array.from(element.querySelectorAll('input')) as HTMLInputElement[];

      expect(labels.map(label => label.textContent.trim())).toEqual(['Select the first locale', 'Select the second locale']);
      expect(inputs.length).toBe(2);
      expect(inputs[0].id).not.toBe(inputs[1].id);
      expect(labels.map(label => label.htmlFor)).toEqual(inputs.map(input => input.id));
      expect(inputs.map(accessibleName)).toEqual(['Select the first locale', 'Select the second locale']);
    });
  });
});
