import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SelectLocaleComponent } from '../../../shared/components/select-locale/select-locale.component';
import { EXPORT_FORMATS } from '../../models/export';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
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

describe('ExportLocaleComponent export errors', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ExportLocaleComponent>;
  let component: ExportLocaleComponent;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [FormsModule],
      declarations: [ExportLocaleComponent, SelectLocaleComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      schemas: [NO_ERRORS_SCHEMA],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(ExportLocaleComponent);
    component = fixture.componentInstance;
    component.project = { id: 'p1' } as Project;
    component.selectedLocale = { code: 'de_DE', language: 'German', region: 'Germany' };
    component.selectedFormat = EXPORT_FORMATS.find(format => format.code === 'jsonnested');
    spyOn(console, 'error');
  });

  afterEach(() => http.verify());

  /** Exports, and the API answers 400 with the given body, which the download receives as a blob. */
  const exportFailingWith = async (body: Blob) => {
    const done = component.export().catch(() => undefined);
    http.expectOne(req => req.url.includes('/projects/p1/exports')).flush(body, { status: 400, statusText: 'Bad Request' });
    await done;
  };

  it('shows the message of the API, which names the terms the format cannot hold', async () => {
    const message =
      'Nested JSON cannot hold the term "app" together with "app.title": a key cannot have both a value and sub keys. ' +
      'Rename the term or export in a flat format.';

    await exportFailingWith(new Blob([JSON.stringify({ error: { code: 'BadRequest', message } })], { type: 'application/json' }));

    expect(component.errorMessage).toBe(message);
    expect(component.loading).toBe(false);
  });

  it('falls back to the general hint when the body of the 400 cannot be read', async () => {
    await exportFailingWith(new Blob(['<html>Bad Request</html>'], { type: 'text/html' }));

    expect(component.errorMessage).toContain('This format cannot hold some terms of the project');
  });

  it('shows the error as an alert, so screen readers announce it', async () => {
    component.locales = [component.selectedLocale];
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();

    await exportFailingWith(new Blob(['<html>Bad Request</html>'], { type: 'text/html' }));
    fixture.detectChanges();

    const alert: HTMLElement = fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert).withContext('the error is not in a role="alert" element').not.toBeNull();
    expect(alert.textContent).toContain('This format cannot hold some terms of the project');
    expect(alert.querySelector('i.material-icons').getAttribute('aria-hidden')).toBe('true');
  });
});
