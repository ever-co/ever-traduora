import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { environment } from '../../../../environments/environment';
import { EverStatsService, EverStatsStatus } from '../../services/ever-stats.service';
import { StatisticsComponent } from './statistics.component';

describe('StatisticsComponent', () => {
  let http: HttpTestingController;
  const endpoint = `${environment.apiEndpoint}/ever-stats`;

  const status = (overrides: Partial<EverStatsStatus> = {}): EverStatsStatus => ({
    enabled: true,
    reason: 'env',
    toggleEnabled: true,
    toggleReadOnly: false,
    destinationUsable: true,
    nextSendAt: null,
    lastSentAt: null,
    lastStatus: null,
    instanceId: '0572c446-d926-40de-b433-b331dac9a11a',
    keyId: 'AAAAAAAAAAA',
    keyState: 'ok',
    country: 'ZZ',
    installSource: 'self-hosted',
    version: '0.23.0',
    channel: 'stable',
    ...overrides,
  });

  const render = (current: EverStatsStatus) => {
    const fixture = TestBed.createComponent(StatisticsComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/status`).flush({ data: current });
    http.expectOne(`${endpoint}/reports`).flush({ data: [] });
    fixture.detectChanges();
    return fixture;
  };

  const button = (fixture: any, text: string) =>
    fixture.debugElement.queryAll(By.css('button')).find((b: any) => b.nativeElement.textContent.trim() === text);

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [StatisticsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      schemas: [NO_ERRORS_SCHEMA],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('turns the statistics off through the API', () => {
    const fixture = render(status());
    button(fixture, 'Turn off').nativeElement.click();
    const req = http.expectOne(`${endpoint}/enabled`);
    expect(req.request.method).toBe('PUT');
    expect(req.request.body).toEqual({ enabled: false });
    req.flush({ data: { enabled: false } });
    http.expectOne(`${endpoint}/status`).flush({ data: status({ enabled: false, toggleEnabled: false, reason: 'ui' }) });
    http.expectOne(`${endpoint}/reports`).flush({ data: [] });
  });

  it('disables Send now while the statistics are off', () => {
    const fixture = render(status({ enabled: false, toggleEnabled: false, reason: 'ui' }));
    expect(button(fixture, 'Send now').nativeElement.disabled).toBe(true);
  });

  it('cannot change the switch of a cloud-managed installation', () => {
    const fixture = render(status({ reason: 'cloud-managed', toggleReadOnly: true }));
    expect(button(fixture, 'Turn off').nativeElement.disabled).toBe(true);
  });
});

describe('EverStatsService.isAvailable', () => {
  let http: HttpTestingController;
  let service: EverStatsService;
  const url = `${environment.apiEndpoint}/ever-stats/status`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(EverStatsService);
  });

  const answer = (respond: (req: any) => void) => {
    let result: boolean | undefined;
    service.isAvailable().subscribe(value => (result = value));
    respond(http.expectOne(url));
    return result;
  };

  it('is true for the operator', () => {
    expect(answer(req => req.flush({ data: { enabled: false } }))).toBe(true);
  });

  it('is false on 403 and 404, and for any other body', () => {
    expect(answer(req => req.flush({}, { status: 403, statusText: 'Forbidden' }))).toBe(false);
    expect(answer(req => req.flush({}, { status: 404, statusText: 'Not Found' }))).toBe(false);
    expect(answer(req => req.flush('<html></html>'))).toBe(false);
  });
});
