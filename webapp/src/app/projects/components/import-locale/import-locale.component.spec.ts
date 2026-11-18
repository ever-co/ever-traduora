import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngxs/store';
import { Subject, throwError } from 'rxjs';
import { SelectLocaleComponent } from '../../../shared/components/select-locale/select-locale.component';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
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

describe('ImportLocaleComponent import errors', () => {
  const create = (importService: Partial<ImportService>) => {
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [ImportLocaleComponent, SelectLocaleComponent],
      providers: [
        { provide: ImportService, useValue: importService },
        { provide: Store, useValue: {} },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    spyOn(console, 'error');
    const fixture = TestBed.createComponent(ImportLocaleComponent);
    const component = fixture.componentInstance;
    component.project = { id: 'p1' } as Project;
    component.knownLocales = [{ code: 'de_DE', language: 'German', region: 'Germany' }];
    component.files = [new File(['{}'], 'de.json')];
    fixture.detectChanges();
    return { fixture, component };
  };

  it('shows the error of a failed import as an alert, so screen readers announce it', async () => {
    // The API refuses the file as too large.
    const { fixture, component } = create({ import: () => throwError(() => ({ status: 413 })) });
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();

    await component.import();
    fixture.detectChanges();

    const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert).withContext('the error is not in a role="alert" element').not.toBeNull();
    expect(alert.textContent).toContain('The file that you are trying to import is too large');
    expect(alert.querySelector('i.material-icons').getAttribute('aria-hidden')).toBe('true');
  });

  it('announces a retry that fails with the same error again, as a new alert', async () => {
    let request: Subject<never>;
    const { fixture, component } = create({ import: () => (request = new Subject<never>()) });
    const failing = component.import();
    request.error({ status: 413 });
    await failing;
    fixture.detectChanges();
    const first: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(first).not.toBeNull();

    const retry = component.import();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]'))
      .withContext('the alert of the first failure is still shown while the retry runs')
      .toBeNull();

    request.error({ status: 413 });
    await retry;
    fixture.detectChanges();
    const second: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second.textContent).toBe(first.textContent);
  });
});
