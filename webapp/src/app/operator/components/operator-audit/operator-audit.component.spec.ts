import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../../../environments/environment';
import { OperatorAuditEntry } from '../../models/operator';
import { OperatorAuditComponent } from './operator-audit.component';

describe('OperatorAuditComponent', () => {
  const endpoint = environment.apiEndpoint;
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const entry = (id: string, organization: OperatorAuditEntry['organization']): OperatorAuditEntry => ({
    id,
    action: 'suspend',
    operator: { userId: 'op', email: 'ops@example.test' },
    organization,
    reason: 'Chargeback, account under review',
    date: { created: '2026-11-28T10:00:00.000Z' },
  });

  const expectAudit = (): TestRequest => http.expectOne(request => request.url === `${endpoint}/operator/audit`);

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([{ path: 'operator/audit', component: OperatorAuditComponent }])],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  it('lists every operator action, with the organization when it can still be found', async () => {
    await harness.navigateByUrl('/operator/audit');
    const req = expectAudit();
    expect(req.request.params.has('organizationId')).toBe(false);
    req.flush({ data: [entry('a1', { id: 'o1', name: 'Acme', slug: 'acme' }), entry('a2', null)], meta: { total: 2, page: 1, limit: 25 } });
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    const rows = Array.from(root.querySelectorAll('[data-test="audit"]'));
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('/orgs/acme');
    expect(rows[0].textContent).toContain('ops@example.test');
    expect(rows[1].textContent).toContain('No longer found');
    expect(root.querySelector('[data-test="count"]')?.textContent?.trim()).toBe('2 actions');
    expect(root.querySelector('[data-test="scope"]')).toBeNull();
  });

  it('keeps to one organization from the address', async () => {
    await harness.navigateByUrl('/operator/audit?organizationId=o1&page=2');
    const req = expectAudit();
    expect(req.request.params.get('organizationId')).toBe('o1');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ data: [], meta: { total: 0, page: 2, limit: 25 } });
    harness.detectChanges();
    expect((harness.routeNativeElement as HTMLElement).querySelector('[data-test="scope"]')).not.toBeNull();
  });
});
