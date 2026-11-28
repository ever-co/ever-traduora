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
    expect(rows).toHaveSize(2);
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

  it('names the newer operator actions in words', async () => {
    await harness.navigateByUrl('/operator/audit');
    const org = { id: 'o1', name: 'Acme', slug: 'acme' };
    expectAudit().flush({
      data: [
        { ...entry('a1', org), action: 'release_slug' },
        { ...entry('a2', org), action: 'retry_billing_cancellation' },
      ],
      meta: { total: 2, page: 1, limit: 25 },
    });
    harness.detectChanges();
    const rows = Array.from((harness.routeNativeElement as HTMLElement).querySelectorAll('[data-test="audit"]'));
    expect(rows[0].textContent).toContain('release address');
    expect(rows[1].textContent).toContain('retry billing');
  });

  it("never shows one query's rows under another, not even when the other fails", async () => {
    await harness.navigateByUrl('/operator/audit');
    expectAudit().flush({ data: [entry('a1', null)], meta: { total: 1, page: 1, limit: 25 } });
    harness.detectChanges();

    await harness.navigateByUrl('/operator/audit?organizationId=o2');
    expectAudit().flush({ error: { code: 'Internal' } }, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    expect(root.querySelectorAll('[data-test="audit"]')).toHaveSize(0);
    expect(root.querySelector('[data-test="error"]')).not.toBeNull();
  });

  it('drops a late answer to "Try again" once the query changed', async () => {
    await harness.navigateByUrl('/operator/audit?organizationId=o1');
    expectAudit().flush({ error: { code: 'Internal' } }, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();
    ((harness.routeNativeElement as HTMLElement).querySelector('[data-test="error"] button') as HTMLButtonElement).click();
    const retry = expectAudit();
    expect(retry.request.params.get('organizationId')).toBe('o1');

    await harness.navigateByUrl('/operator/audit?organizationId=o2');
    expect(retry.cancelled).toBe(true);
    const current = expectAudit();
    expect(current.request.params.get('organizationId')).toBe('o2');
    current.flush({ data: [], meta: { total: 0, page: 1, limit: 25 } });
    harness.detectChanges();
    expect((harness.routeNativeElement as HTMLElement).querySelector('[data-test="empty"]')).not.toBeNull();
  });
});
