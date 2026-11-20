import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { EverManagedView } from '../../services/ever-platform.service';
import { MaintenanceComponent } from './maintenance.component';

describe('MaintenanceComponent', () => {
  let http: HttpTestingController;
  const url = `${environment.apiEndpoint}/ever-connect/managed`;

  const view = (overrides: Partial<EverManagedView> = {}): EverManagedView => ({
    available: true,
    optIn: true,
    kinds: ['health_report', 'backup'],
    supportedKinds: ['health_report', 'backup', 'restore_check'],
    windows: [{ days: [0, 6], from: '02:00', to: '04:00' }],
    backupDirSet: false,
    history: [],
    ...overrides,
  });

  const render = (current: EverManagedView): ComponentFixture<MaintenanceComponent> => {
    const fixture = TestBed.createComponent(MaintenanceComponent);
    fixture.detectChanges();
    http.expectOne(url).flush({ data: current });
    fixture.detectChanges();
    return fixture;
  };

  const text = (fixture: ComponentFixture<MaintenanceComponent>) => fixture.nativeElement.textContent as string;

  const button = (fixture: ComponentFixture<MaintenanceComponent>, label: string) =>
    fixture.debugElement.queryAll(By.css('button')).find(b => b.nativeElement.textContent.trim() === label);

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [MaintenanceComponent],
      imports: [FormsModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      schemas: [NO_ERRORS_SCHEMA],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the opt-in, the kinds and the windows the API returns', () => {
    const fixture = render(view());
    const component = fixture.componentInstance;
    expect(text(fixture)).toContain('Maintenance operations');
    expect(component.optIn).toBe(true);
    expect(component.kinds).toEqual({ health_report: true, backup: true, restore_check: false });
    expect(component.windows).toEqual([{ days: [true, false, false, false, false, false, true], from: '02:00', to: '04:00' }]);
    expect(component.changed).toBe(false);
    expect(button(fixture, 'Save').nativeElement.disabled).toBe(true);
  });

  it('saves the opt-in, the kinds and the windows, and no directory when none is entered', () => {
    const fixture = render(view());
    const component = fixture.componentInstance;
    component.kinds.restore_check = true;
    component.windows[0].days[1] = true;
    fixture.detectChanges();
    button(fixture, 'Save').nativeElement.click();
    const req = http.expectOne(url);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({
      optIn: true,
      kinds: ['health_report', 'backup', 'restore_check'],
      windows: [{ days: [0, 1, 6], from: '02:00', to: '04:00' }],
    });
    // The fields are locked until the answer replaces them
    fixture.detectChanges();
    const fields = fixture.debugElement.query(By.css('form > fieldset')).nativeElement as HTMLFieldSetElement;
    expect(fields.disabled).toBe(true);
    req.flush({ data: view({ kinds: ['health_report', 'backup', 'restore_check'], windows: [{ days: [0, 1, 6], from: '02:00', to: '04:00' }] }) });
    fixture.detectChanges();
    expect(fields.disabled).toBe(false);
    expect(component.message).toBe('Saved.');
    expect(component.changed).toBe(false);
  });

  it('sends a new backup directory, and an empty one to remove it', () => {
    const fixture = render(view({ backupDirSet: true }));
    const component = fixture.componentInstance;
    expect(text(fixture)).toContain('A backup directory is set');
    component.backupDir = ' /app/api/backups ';
    component.save();
    let req = http.expectOne(url);
    expect(req.request.body.backupDir).toBe('/app/api/backups');
    req.flush({ data: view({ backupDirSet: true }) });
    expect(component.backupDir).toBe('');

    component.removeBackupDir = true;
    component.save();
    req = http.expectOne(url);
    expect(req.request.body.backupDir).toBe('');
    req.flush({ data: view({ backupDirSet: false }) });
  });

  it('does not save a window without a day, with equal times, or a relative directory', () => {
    const fixture = render(view());
    const component = fixture.componentInstance;

    component.windows[0].days = component.windows[0].days.map(() => false);
    fixture.detectChanges();
    expect(text(fixture)).toContain('Choose at least one day.');
    expect(button(fixture, 'Save').nativeElement.disabled).toBe(true);
    component.save();

    component.windows[0].days[3] = true;
    component.windows[0].to = '02:00';
    expect(component.windowError(component.windows[0])).toBe('The start and the end time must differ.');
    component.windows[0].to = '25:00';
    expect(component.windowError(component.windows[0])).toContain('HH:MM');
    component.windows[0].to = '01:00';
    expect(component.windowError(component.windows[0])).toBeNull();

    component.backupDir = 'backups';
    fixture.detectChanges();
    expect(component.backupDirError).toContain('absolute path');
    expect(component.valid).toBe(false);
    component.save();
    component.backupDir = 'C:\\backups';
    expect(component.valid).toBe(true);
    http.expectNone(url);
  });

  it('adds windows up to the limit the API takes, and removes them', () => {
    const fixture = render(view({ windows: [] }));
    const component = fixture.componentInstance;
    expect(component.warning).toBe('There is no window: nothing will run.');
    for (let i = 0; i < 20; i++) component.addWindow();
    expect(component.windows).toHaveSize(14);
    component.removeWindow(0);
    expect(component.windows).toHaveSize(13);
  });

  it('warns while backups are allowed without a backup directory', () => {
    const fixture = render(view({ backupDirSet: false }));
    const component = fixture.componentInstance;
    expect(component.warning).toBe('Backups and backup checks need a backup directory: they will not run without one.');
    component.backupDir = '/app/api/backups';
    expect(component.warning).toBeNull();
    component.backupDir = '';
    component.kinds.backup = false;
    expect(component.warning).toBeNull();

    const withDirectory = render(view({ backupDirSet: true })).componentInstance;
    expect(withDirectory.warning).toBeNull();
    withDirectory.removeBackupDir = true;
    expect(withDirectory.warning).toContain('need a backup directory');
  });

  it('warns while opted in with no kind allowed', () => {
    const fixture = render(view({ kinds: [] }));
    expect(fixture.componentInstance.warning).toBe('No kind is allowed: nothing will run.');
    fixture.componentInstance.optIn = false;
    expect(fixture.componentInstance.warning).toBeNull();
  });

  it('offers no backup directory where backups cannot run', () => {
    const fixture = render(view({ supportedKinds: ['health_report'], kinds: ['health_report'] }));
    expect(fixture.debugElement.query(By.css('#everManagedBackupDir'))).toBeNull();
    expect(text(fixture)).toContain('Backups run on SQLite only');
  });

  it('shows the reason the API gives when it refuses the settings', () => {
    const fixture = render(view());
    const component = fixture.componentInstance;
    component.optIn = false;
    component.save();
    http
      .expectOne(url)
      .flush({ error: { code: 'invalid_managed', message: 'The backup directory is an absolute path' } }, { status: 400, statusText: 'Bad Request' });
    expect(component.errorMessage).toBe('This installation cannot use these settings. The backup directory is an absolute path.');
    expect(component.busy).toBe(false);
    // The form keeps what the operator entered
    expect(component.optIn).toBe(false);
  });

  it('lists the recent operations, the latest ten first', () => {
    const history = Array.from({ length: 12 }, (_, i) => ({
      operationId: `op-${i}`,
      kind: i === 0 ? 'backup' : 'health_report',
      status: i === 1 ? 'failed' : 'succeeded',
      reason: i === 1 ? 'outside_window' : null,
      sizeBytes: i === 0 ? 3 * 1024 * 1024 : null,
      at: 1763600000000 - i * 1000,
    }));
    const fixture = render(view({ history }));
    expect(fixture.debugElement.queryAll(By.css('tbody tr'))).toHaveSize(10);
    expect(text(fixture)).toContain('3.0 MB');
    expect(text(fixture)).toContain('Outside your windows');
    button(fixture, 'Show all 12').nativeElement.click();
    fixture.detectChanges();
    expect(fixture.debugElement.queryAll(By.css('tbody tr'))).toHaveSize(12);
  });

  it('shows nothing where the API does not answer (Ever operates the installation)', () => {
    const fixture = TestBed.createComponent(MaintenanceComponent);
    fixture.detectChanges();
    http.expectOne(url).flush({ error: { code: 'NotFound' } }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(text(fixture).trim()).toBe('');
  });

  it('offers to try again when it cannot be read', () => {
    const fixture = TestBed.createComponent(MaintenanceComponent);
    fixture.detectChanges();
    http.expectOne(url).flush({}, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(text(fixture)).toContain('That did not work. Please try again.');
    button(fixture, 'Try again').nativeElement.click();
    http.expectOne(url).flush({ data: view() });
    fixture.detectChanges();
    expect(fixture.componentInstance.errorMessage).toBeNull();
    expect(fixture.componentInstance.view).not.toBeNull();
  });
});
