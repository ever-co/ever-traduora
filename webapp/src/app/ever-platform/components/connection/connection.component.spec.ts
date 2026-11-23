import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { environment } from '../../../../environments/environment';
import { EverConnectStatus, EverPlatformService } from '../../services/ever-platform.service';
import { ConnectionComponent } from './connection.component';

const notConnected: EverConnectStatus = {
  connected: false,
  status: 'not_connected',
  registryInstanceId: null,
  orgId: null,
  linkId: null,
  linkState: null,
  displayName: null,
  connectedAt: null,
  lastHeartbeatAt: null,
  entitlement: { state: 'none', tier: null, expiresAt: null, error: null },
  installSource: 'self-hosted',
  destinationUsable: true,
};

describe('ConnectionComponent', () => {
  let http: HttpTestingController;
  const endpoint = `${environment.apiEndpoint}/ever-connect`;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [ConnectionComponent],
      imports: [FormsModule],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      schemas: [NO_ERRORS_SCHEMA],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('posts the code and the name once, and calls nothing else before', () => {
    const fixture = TestBed.createComponent(ConnectionComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/status`).flush({ data: notConnected });
    http.expectOne(`${endpoint}/audit`).flush({ data: [] });

    fixture.componentInstance.code = ' EVC-TEST-0000-0001 ';
    fixture.componentInstance.displayName = 'Our translations';
    fixture.componentInstance.connect();
    const req = http.expectOne(`${endpoint}/connect`);
    expect(req.request.body).toEqual({ code: 'EVC-TEST-0000-0001', displayName: 'Our translations' });
    req.flush({ data: { ...notConnected, connected: true, status: 'active' } });
    http.expectOne(`${endpoint}/status`).flush({ data: { ...notConnected, connected: true, status: 'active' } });
    http.expectOne(`${endpoint}/audit`).flush({ data: [] });
    http.expectOne(`${endpoint}/integrations`).flush({ data: [] });
    expect(fixture.componentInstance.message).toBe('Connected.');
  });
});

describe('EverPlatformService.pages', () => {
  let http: HttpTestingController;
  let service: EverPlatformService;
  const url = `${environment.apiEndpoint}/ever-platform/status`;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(EverPlatformService);
  });

  const answer = (respond: (req: any) => void) => {
    let result: unknown = 'unset';
    service.pages().subscribe(value => (result = value));
    respond(http.expectOne(url));
    return result;
  };

  it('lists the pages for the operator', () => {
    expect(answer(req => req.flush({ data: { stats: false, connect: true } }))).toEqual({ stats: false, connect: true });
  });

  it('is empty on 403 and 404, and for any other body', () => {
    expect(answer(req => req.flush({}, { status: 403, statusText: 'Forbidden' }))).toBeNull();
    expect(answer(req => req.flush({}, { status: 404, statusText: 'Not Found' }))).toBeNull();
    expect(answer(req => req.flush('<html></html>'))).toBeNull();
  });
});
