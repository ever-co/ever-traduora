import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { environment } from '../../../../environments/environment';
import { OperatorAuditEntry, OperatorOrganizationDetail } from '../../models/operator';
import { OperatorOrganizationComponent } from './operator-organization.component';

describe('OperatorOrganizationComponent', () => {
  const endpoint = environment.apiEndpoint;
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const entry = (action: OperatorAuditEntry['action'], reason: string): OperatorAuditEntry => ({
    id: `a-${action}`,
    action,
    operator: { userId: 'op', email: 'ops@example.test' },
    organization: { id: 'o1', name: 'Acme', slug: 'acme' },
    reason,
    date: { created: '2026-11-28T10:00:00.000Z' },
  });

  const detail = (extra: Partial<OperatorOrganizationDetail> = {}): OperatorOrganizationDetail => ({
    id: 'o1',
    name: 'Acme',
    slug: 'acme',
    status: 'active',
    planCode: 'small_business',
    isDefault: false,
    owner: { userId: 'u1', name: 'Ada', email: 'ada@acme.test' },
    membersCount: 3,
    projectsCount: 2,
    seatsUsed: 4,
    stringsUsed: 120,
    date: { created: '2026-11-28T10:00:00.000Z', modified: '2026-11-28T10:00:00.000Z' },
    plan: { code: 'starter', name: 'Starter' },
    usage: { seats: { used: 4, included: 15 }, strings: { used: 10_000, limit: 10_000 } },
    audit: [],
    ...extra,
  });

  const open = async (answer: OperatorOrganizationDetail = detail()) => {
    await harness.navigateByUrl('/operator/organizations/o1');
    http.expectOne(`${endpoint}/operator/organizations/o1`).flush({ data: answer });
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  };

  const q = (root: HTMLElement, test: string) => root.querySelector(`[data-test="${test}"]`) as HTMLElement | null;

  /** The element, or a failure naming what is missing. */
  const css = (root: Element, selector: string): HTMLElement => {
    const found = root.querySelector(selector);
    if (!found) {
      throw new Error(`Nothing matches ${selector}`);
    }
    return found as HTMLElement;
  };

  const el = (root: HTMLElement, test: string) => css(root, `[data-test="${test}"]`);

  const typeReason = (root: HTMLElement, value: string) => {
    const textarea = root.querySelector('#opReason') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    harness.detectChanges();
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([{ path: 'operator/organizations/:id', component: OperatorOrganizationComponent }]),
      ],
    });
    http = TestBed.inject(HttpTestingController);
    harness = await RouterTestingHarness.create();
  });

  afterEach(() => http.verify());

  it('shows the effective plan, the live usage, the owner and the counts', async () => {
    const root = await open();
    expect(root.textContent).toContain('/orgs/acme');
    expect(el(root, 'plan').textContent).toContain('Starter');
    expect(el(root, 'plan').textContent).toContain('Small Business lapsed');
    expect(el(root, 'usage-seats').textContent).toContain('4 of 15');
    expect(el(root, 'usage-strings').textContent).toContain('10,000 of 10,000');
    expect(css(el(root, 'usage-strings'), 'progress').classList).toContain('op-meter-full');
    expect(root.textContent).toContain('ada@acme.test');
    expect(el(root, 'projects').textContent?.trim()).toBe('2');
    expect(root.textContent).toContain('28 Nov 2026');
    expect(q(root, 'audit-empty')).not.toBeNull();
  });

  it('suspends an active organization with a reason, after a confirmation', async () => {
    const root = await open();
    expect(el(root, 'ask').textContent?.trim()).toBe('Suspend');
    expect(el(root, 'action').classList).toContain('op-danger');

    // No reason, or one too short once trimmed: nothing is asked yet
    el(root, 'ask').click();
    harness.detectChanges();
    expect(q(root, 'confirm')).toBeNull();
    typeReason(root, '  ab  ');
    el(root, 'ask').click();
    harness.detectChanges();
    expect(q(root, 'confirm')).toBeNull();
    expect(css(root, '#opReason').classList).toContain('is-invalid');

    typeReason(root, '  Chargeback, account under review ');
    el(root, 'ask').click();
    harness.detectChanges();
    expect(el(root, 'confirm').textContent).toContain('Suspend Acme now?');
    http.expectNone(`${endpoint}/operator/organizations/o1/suspend`);

    el(root, 'confirm-button').click();
    const req = http.expectOne(`${endpoint}/operator/organizations/o1/suspend`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'Chargeback, account under review' });
    req.flush({ data: detail({ status: 'suspended', audit: [entry('suspend', 'Chargeback, account under review')] }) });
    harness.detectChanges();

    expect(el(root, 'status').textContent?.trim()).toBe('suspended');
    expect(el(root, 'ask').textContent?.trim()).toBe('Restore');
    expect((root.querySelector('#opReason') as HTMLTextAreaElement).value).toBe('');
    const rows = Array.from(root.querySelectorAll('[data-test="audit"]'));
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('ops@example.test');
    expect(rows[0].textContent).toContain('Chargeback, account under review');
  });

  it('restores a suspended organization', async () => {
    const root = await open(detail({ status: 'suspended' }));
    expect(el(root, 'action').classList).not.toContain('op-danger');
    typeReason(root, 'Paid the invoice');
    el(root, 'ask').click();
    harness.detectChanges();
    el(root, 'confirm-button').click();
    const req = http.expectOne(`${endpoint}/operator/organizations/o1/restore`);
    expect(req.request.body).toEqual({ reason: 'Paid the invoice' });
    req.flush({ data: detail({ status: 'active' }) });
    harness.detectChanges();
    expect(el(root, 'ask').textContent?.trim()).toBe('Suspend');
  });

  it('offers nothing to do to the default organization or a deleted one', async () => {
    let root = await open(detail({ isDefault: true }));
    expect(q(root, 'action')).toBeNull();
    expect(q(root, 'default-note')).not.toBeNull();

    await harness.navigateByUrl('/operator/organizations/o2');
    http.expectOne(`${endpoint}/operator/organizations/o2`).flush({ data: detail({ id: 'o2', status: 'deleted' }) });
    harness.detectChanges();
    root = harness.routeNativeElement as HTMLElement;
    expect(q(root, 'action')).toBeNull();
    expect(q(root, 'deleted-note')).not.toBeNull();
  });

  it('shows the status of now when another operator changed it meanwhile', async () => {
    const root = await open();
    typeReason(root, 'Chargeback, account under review');
    el(root, 'ask').click();
    harness.detectChanges();
    el(root, 'confirm-button').click();
    http
      .expectOne(`${endpoint}/operator/organizations/o1/suspend`)
      .flush({ error: { code: 'organization_status', message: 'Not active' } }, { status: 409, statusText: 'Conflict' });
    http.expectOne(`${endpoint}/operator/organizations/o1`).flush({ data: detail({ status: 'suspended' }) });
    harness.detectChanges();
    expect(el(root, 'action-error').textContent).toContain('status changed meanwhile');
    expect(el(root, 'status').textContent?.trim()).toBe('suspended');
    expect(el(root, 'ask').textContent?.trim()).toBe('Restore');
  });

  it('says so for an unknown id', async () => {
    await harness.navigateByUrl('/operator/organizations/o1');
    http.expectOne(`${endpoint}/operator/organizations/o1`).flush({ error: { code: 'NotFound' } }, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(q(harness.routeNativeElement as HTMLElement, 'not-found')).not.toBeNull();
  });
});
