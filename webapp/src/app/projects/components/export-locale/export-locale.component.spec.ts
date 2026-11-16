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

  it('names the locale and fallback locale searches after their visible labels', () => {
    const inputs = Array.from(render().querySelectorAll('app-select-locale input')) as HTMLInputElement[];

    expect(inputs.map(input => input.getAttribute('aria-label'))).toEqual(['Search the locale to export', 'Search the fallback locale']);
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
