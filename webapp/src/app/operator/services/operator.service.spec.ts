import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { OperatorService } from './operator.service';

describe('OperatorService', () => {
  const endpoint = environment.apiEndpoint;
  let service: OperatorService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(OperatorService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads an operator from the status route in SaaS mode', async () => {
    const answer = firstValueFrom(service.isOperator());
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: true });
    http.expectOne(`${endpoint}/operator/status`).flush({ data: { operator: true } });
    expect(await answer).toBe(true);
  });

  it('reads a 404 from the status route as "not an operator", not as an error', async () => {
    const answer = firstValueFrom(service.isOperator());
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: true });
    http.expectOne(`${endpoint}/operator/status`).flush({ error: { code: 'NotFound' } }, { status: 404, statusText: 'Not Found' });
    expect(await answer).toBe(false);
  });

  it('reads any other body as "not an operator"', async () => {
    const answer = firstValueFrom(service.isOperator());
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: true });
    http.expectOne(`${endpoint}/operator/status`).flush('<!doctype html>');
    expect(await answer).toBe(false);
  });

  it('asks nothing of the operator routes on a self-hosted install', async () => {
    const answer = firstValueFrom(service.isOperator());
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: false });
    http.expectNone(`${endpoint}/operator/status`);
    expect(await answer).toBe(false);
  });

  it('sends only the set filters of the list, the text trimmed', () => {
    service.organizations({ q: '  acme ', status: '', page: 2, limit: 25 }).subscribe();
    const req = http.expectOne(request => request.url === `${endpoint}/operator/organizations`);
    expect(req.request.params.get('q')).toBe('acme');
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.params.get('page')).toBe('2');
    expect(req.request.params.get('limit')).toBe('25');
    req.flush({ data: [], meta: { total: 0, page: 2, limit: 25 } });
  });

  it('suspends and restores with the trimmed reason', () => {
    service.suspend('o1', '  Chargeback under review  ').subscribe();
    const suspend = http.expectOne(`${endpoint}/operator/organizations/o1/suspend`);
    expect(suspend.request.method).toBe('POST');
    expect(suspend.request.body).toEqual({ reason: 'Chargeback under review' });
    suspend.flush({ data: {} });

    service.restore('o1', 'Paid').subscribe();
    const restore = http.expectOne(`${endpoint}/operator/organizations/o1/restore`);
    expect(restore.request.body).toEqual({ reason: 'Paid' });
    restore.flush({ data: {} });
  });

  it('keeps the audit log to one organization when asked', () => {
    service.audit({ organizationId: 'o1', page: 1, limit: 25 }).subscribe();
    const req = http.expectOne(request => request.url === `${endpoint}/operator/audit`);
    expect(req.request.params.get('organizationId')).toBe('o1');
    req.flush({ data: [], meta: { total: 0, page: 1, limit: 25 } });
  });
});
