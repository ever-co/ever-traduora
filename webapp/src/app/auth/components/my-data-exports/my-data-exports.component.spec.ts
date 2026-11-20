import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { EverPersonExport } from '../../../ever-platform/services/ever-platform.service';
import { exportFileName, MyDataExportsComponent } from './my-data-exports.component';

describe('MyDataExportsComponent', () => {
  let http: HttpTestingController;
  const url = `${environment.apiEndpoint}/ever-connect/me/exports`;

  const made = Date.UTC(2026, 10, 18, 9, 30);
  const day = 24 * 60 * 60 * 1000;
  const rows: EverPersonExport[] = [
    { jobId: 'job_2', createdAt: made + day, expiresAt: made + 8 * day },
    { jobId: 'job_1', createdAt: made, expiresAt: made + 7 * day },
  ];

  const render = (respond: (req: any) => void): ComponentFixture<MyDataExportsComponent> => {
    const fixture = TestBed.createComponent(MyDataExportsComponent);
    fixture.detectChanges();
    respond(http.expectOne(url));
    fixture.detectChanges();
    return fixture;
  };

  const text = (fixture: ComponentFixture<MyDataExportsComponent>) => fixture.nativeElement.textContent as string;

  const buttons = (fixture: ComponentFixture<MyDataExportsComponent>, label: string) =>
    fixture.debugElement.queryAll(By.css('button')).filter(b => b.nativeElement.textContent.trim() === label);

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [MyDataExportsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      schemas: [NO_ERRORS_SCHEMA],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists the exports of the signed-in user with when they were made and until when they can be downloaded', () => {
    const fixture = render(req => req.flush({ data: rows }));
    expect(text(fixture)).toContain('My data exports');
    expect(fixture.debugElement.queryAll(By.css('li')).length).toBe(2);
    expect(text(fixture)).toContain('Available until');
    expect(buttons(fixture, 'Download').length).toBe(2);
  });

  it('says so when there is no export', () => {
    const fixture = render(req => req.flush({ data: [] }));
    expect(text(fixture)).toContain('You have no export to download.');
    expect(fixture.debugElement.queryAll(By.css('li')).length).toBe(0);
  });

  it('shows nothing while the connection module is not loaded', () => {
    const fixture = render(req => req.flush({ error: { code: 'NotFound' } }, { status: 404, statusText: 'Not Found' }));
    expect(text(fixture).trim()).toBe('');
  });

  it('offers to try again when the list cannot be read', () => {
    const fixture = render(req => req.flush({}, { status: 500, statusText: 'Server Error' }));
    expect(text(fixture)).toContain('Your exports could not be loaded.');
    buttons(fixture, 'Try again')[0].nativeElement.click();
    http.expectOne(url).flush({ data: rows });
    fixture.detectChanges();
    expect(text(fixture)).not.toContain('could not be loaded');
    expect(fixture.debugElement.queryAll(By.css('li')).length).toBe(2);
  });

  it('downloads one export as a JSON file', async () => {
    const fixture = render(req => req.flush({ data: rows }));
    const save = spyOn(fixture.componentInstance, 'save');
    buttons(fixture, 'Download')[1].nativeElement.click();
    fixture.detectChanges();
    expect(buttons(fixture, 'Downloading...').length).toBe(1);
    const bundle = { profile: { name: 'Member' }, projects: [] };
    http.expectOne(`${url}/job_1`).flush({ data: bundle });
    fixture.detectChanges();
    expect(save).toHaveBeenCalledTimes(1);
    const [blob, name] = save.calls.mostRecent().args;
    expect(name).toBe('traduora-export-2026-11-18-job_1.json');
    expect(blob.type).toBe('application/json');
    expect(JSON.parse(await blob.text())).toEqual(bundle);
    expect(buttons(fixture, 'Download').length).toBe(2);
  });

  it('drops an export that expired meanwhile from the list', () => {
    const fixture = render(req => req.flush({ data: rows }));
    const save = spyOn(fixture.componentInstance, 'save');
    fixture.componentInstance.download(rows[0]);
    http.expectOne(`${url}/job_2`).flush({ error: { code: 'NotFound' } }, { status: 404, statusText: 'Not Found' });
    fixture.detectChanges();
    expect(save).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('This export is no longer available.');
    expect(fixture.componentInstance.exports.map(row => row.jobId)).toEqual(['job_1']);
  });

  it('names the file after the day the export was made and its id only', () => {
    expect(exportFileName({ jobId: 'a/b..c', createdAt: made, expiresAt: made + 7 * day })).toBe('traduora-export-2026-11-18-abc.json');
  });
});
