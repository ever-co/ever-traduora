import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngxs/store';
import { SelectLocaleComponent } from '../../../shared/components/select-locale/select-locale.component';
import { Locale } from '../../models/locale';
import { ImportService } from '../../services/import.service';
import { ImportLocaleComponent } from './import-locale.component';

describe('ImportLocaleComponent', () => {
  const locales: Locale[] = [
    { code: 'de_DE', language: 'German', region: 'Germany' },
    { code: 'en_US', language: 'English', region: 'United States' },
  ];

  // The name assistive tech reads: aria-label wins over a linked <label>.
  const accessibleName = (input: HTMLInputElement): string =>
    input.getAttribute('aria-label') || Array.from(input.labels || [], label => label.textContent.trim()).join(' ');

  // The destination locale picker shows once a file has been chosen.
  const render = (): HTMLElement => {
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [ImportLocaleComponent, SelectLocaleComponent],
      providers: [
        { provide: ImportService, useValue: {} },
        { provide: Store, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    const fixture = TestBed.createComponent(ImportLocaleComponent);
    fixture.componentInstance.knownLocales = locales;
    fixture.componentInstance.files = [new File(['{}'], 'de.json')];
    fixture.detectChanges();
    return fixture.nativeElement;
  };

  it('points the destination locale label at its search input', () => {
    const element = render();
    const label = (Array.from(element.querySelectorAll('label')) as HTMLLabelElement[]).find(
      l => l.textContent.trim() === 'Select the destination locale',
    );
    const input: HTMLInputElement = element.querySelector('app-select-locale input');

    expect(label).withContext('no "Select the destination locale" label').toBeDefined();
    expect(input.id).toBeTruthy();
    expect(label.htmlFor).toBe(input.id);
  });

  it('names the destination locale search by its visible label', () => {
    const input: HTMLInputElement = render().querySelector('app-select-locale input');

    expect(accessibleName(input)).toBe('Select the destination locale');
  });

  it('names the destination locale option list', () => {
    const list: HTMLElement = render().querySelector('app-select-locale [role="group"]');

    expect(list.getAttribute('aria-label')).toBe('Destination locale');
  });
});
