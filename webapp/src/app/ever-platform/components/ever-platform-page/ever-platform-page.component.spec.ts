import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { EverPlatformPageComponent } from './ever-platform-page.component';

describe('EverPlatformPageComponent', () => {
  let http: HttpTestingController;
  const url = `${environment.apiEndpoint}/ever-platform/status`;

  /** The sections the page shows for an answer of the status probe. */
  const sections = (respond: (req: any) => void): string[] => {
    const fixture = TestBed.createComponent(EverPlatformPageComponent);
    fixture.detectChanges();
    respond(http.expectOne(url));
    fixture.detectChanges();
    return ['app-ever-platform-connection', 'app-ever-platform-maintenance', 'app-ever-platform-statistics'].filter(
      selector => !!fixture.debugElement.query(By.css(selector)),
    );
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EverPlatformPageComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      schemas: [NO_ERRORS_SCHEMA],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the maintenance operations with the connection, to the operator only', () => {
    expect(sections(req => req.flush({ data: { stats: true, connect: true } }))).toEqual([
      'app-ever-platform-connection',
      'app-ever-platform-maintenance',
      'app-ever-platform-statistics',
    ]);
    expect(sections(req => req.flush({ data: { stats: true, connect: false } }))).toEqual(['app-ever-platform-statistics']);
    expect(sections(req => req.flush({}, { status: 404, statusText: 'Not Found' }))).toEqual([]);
  });
});
