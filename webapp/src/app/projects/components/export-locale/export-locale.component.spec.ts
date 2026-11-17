import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SelectLocaleComponent } from '../../../shared/components/select-locale/select-locale.component';
import { Locale } from '../../models/locale';
import { ExportService } from '../../services/export.service';
import { ExportLocaleComponent } from './export-locale.component';

describe('ExportLocaleComponent', () => {
  const locales: Locale[] = [
    { code: 'de_DE', language: 'German', region: 'Germany' },
    { code: 'en_US', language: 'English', region: 'United States' },
  ];

  const render = (): HTMLElement => {
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [ExportLocaleComponent, SelectLocaleComponent],
      providers: [{ provide: ExportService, useValue: {} }],
      schemas: [NO_ERRORS_SCHEMA],
    });
    const fixture = TestBed.createComponent(ExportLocaleComponent);
    fixture.componentInstance.locales = locales;
    fixture.detectChanges();
    return fixture.nativeElement;
  };

  const pickerLabels = ['Select the locale to export', 'Select the fallback locale (optional)'];

  // The name assistive tech reads: aria-label wins over a linked <label>.
  const accessibleName = (input: HTMLInputElement): string =>
    input.getAttribute('aria-label') || Array.from(input.labels || [], label => label.textContent.trim()).join(' ');

  it('points the locale and fallback locale labels at their own search inputs', () => {
    const element = render();
    const labels = pickerLabels.map(text =>
      (Array.from(element.querySelectorAll('label')) as HTMLLabelElement[]).find(label => label.textContent.trim() === text),
    );
    const inputs = Array.from(element.querySelectorAll('app-select-locale input')) as HTMLInputElement[];

    expect(labels.every(label => !!label))
      .withContext('a picker label is missing')
      .toBeTrue();
    expect(inputs.length).toBe(2);
    expect(inputs[0].id).not.toBe(inputs[1].id);
    expect(labels.map(label => label.htmlFor)).toEqual(inputs.map(input => input.id));
  });

  it('names the locale and fallback locale searches by their visible labels', () => {
    const inputs = Array.from(render().querySelectorAll('app-select-locale input')) as HTMLInputElement[];

    expect(inputs.map(accessibleName)).toEqual(pickerLabels);
  });

  it('names the locale and fallback locale option lists apart', () => {
    const lists = Array.from(render().querySelectorAll('app-select-locale [role="group"]')) as HTMLElement[];

    expect(lists.map(list => list.getAttribute('aria-label'))).toEqual(['Locale to export', 'Fallback locale']);
  });

  it('has no id that two elements share', () => {
    const ids = Array.from(render().querySelectorAll('[id]')).map(el => el.id);

    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
