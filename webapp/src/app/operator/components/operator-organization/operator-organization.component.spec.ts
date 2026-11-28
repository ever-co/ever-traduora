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
    billingCancellation: null,
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

  /** The panel of one action, its reason, and its two steps. */
  const panel = (root: HTMLElement, kind: string) => el(root, `action-${kind}`);

  const typeReason = (root: HTMLElement, kind: string, value: string) => {
    const textarea = css(panel(root, kind), '[data-test="reason"]') as HTMLTextAreaElement;
    textarea.value = value;
    textarea.dispatchEvent(new Event('input'));
    harness.detectChanges();
  };

  /** Types the reason, asks, and confirms. */
  const act = (root: HTMLElement, kind: string, reason: string) => {
    typeReason(root, kind, reason);
    css(panel(root, kind), '[data-test="ask"]').click();
    harness.detectChanges();
    css(panel(root, kind), '[data-test="confirm-button"]').click();
  };

  const releasedSlug = `deleted-${'ab'.repeat(16)}`;

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
    expect(q(root, 'billing-notice')).toBeNull();
  });

  it('suspends an active organization with a reason, after a confirmation', async () => {
    const root = await open();
    expect(css(panel(root, 'suspend'), '[data-test="ask"]').textContent?.trim()).toBe('Suspend');
    expect(panel(root, 'suspend').classList).toContain('op-danger');

    // No reason, or one too short once trimmed: nothing is asked yet
    css(panel(root, 'suspend'), '[data-test="ask"]').click();
    harness.detectChanges();
    expect(q(root, 'confirm')).toBeNull();
    typeReason(root, 'suspend', '  ab  ');
    css(panel(root, 'suspend'), '[data-test="ask"]').click();
    harness.detectChanges();
    expect(q(root, 'confirm')).toBeNull();
    expect(css(panel(root, 'suspend'), '[data-test="reason"]').classList).toContain('is-invalid');

    typeReason(root, 'suspend', '  Chargeback, account under review ');
    css(panel(root, 'suspend'), '[data-test="ask"]').click();
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
    expect(q(root, 'action-suspend')).toBeNull();
    expect(css(panel(root, 'restore'), '[data-test="ask"]').textContent?.trim()).toBe('Restore');
    expect((css(panel(root, 'restore'), '[data-test="reason"]') as HTMLTextAreaElement).value).toBe('');
    const rows = Array.from(root.querySelectorAll('[data-test="audit"]'));
    expect(rows).toHaveSize(1);
    expect(rows[0].textContent).toContain('ops@example.test');
    expect(rows[0].textContent).toContain('Chargeback, account under review');
  });

  it('restores a suspended organization', async () => {
    const root = await open(detail({ status: 'suspended' }));
    expect(panel(root, 'restore').classList).not.toContain('op-danger');
    act(root, 'restore', 'Paid the invoice');
    const req = http.expectOne(`${endpoint}/operator/organizations/o1/restore`);
    expect(req.request.body).toEqual({ reason: 'Paid the invoice' });
    req.flush({ data: detail({ status: 'active' }) });
    harness.detectChanges();
    expect(q(root, 'action-suspend')).not.toBeNull();
  });

  it('offers nothing to do to the default organization', async () => {
    const root = await open(detail({ isDefault: true }));
    expect(root.querySelector('[data-test^="action-"]')).toBeNull();
    expect(q(root, 'default-note')).not.toBeNull();
  });

  it("releases a deleted organization's address once, and labels it in the audit log", async () => {
    const root = await open(detail({ status: 'deleted' }));
    expect(q(root, 'deleted-note')).not.toBeNull();
    expect(q(root, 'action-suspend')).toBeNull();
    expect(panel(root, 'release').classList).toContain('op-danger');
    act(root, 'release', 'Owner asked to reuse the address');
    harness.detectChanges();
    expect(el(root, 'confirm').textContent).toContain('Release /orgs/acme now?');
    const req = http.expectOne(`${endpoint}/operator/organizations/o1/release-slug`);
    expect(req.request.body).toEqual({ reason: 'Owner asked to reuse the address' });
    req.flush({
      data: detail({ status: 'deleted', slug: releasedSlug, audit: [entry('release_slug', 'Owner asked to reuse the address')] }),
    });
    harness.detectChanges();
    expect(q(root, 'action-release')).toBeNull();
    expect(el(root, 'deleted-note').textContent).toContain('Its address was released');
    expect(el(root, 'audit').textContent).toContain('release address');
  });

  it('reads the organization again when its address was released meanwhile', async () => {
    const root = await open(detail({ status: 'deleted' }));
    act(root, 'release', 'Owner asked to reuse the address');
    http
      .expectOne(`${endpoint}/operator/organizations/o1/release-slug`)
      .flush({ error: { code: 'slug_released', message: 'Released' } }, { status: 409, statusText: 'Conflict' });
    http.expectOne(`${endpoint}/operator/organizations/o1`).flush({ data: detail({ status: 'deleted', slug: releasedSlug }) });
    harness.detectChanges();
    expect(el(root, 'action-error').textContent).toContain('released already');
    expect(q(root, 'action-release')).toBeNull();
  });

  it('shows a failed billing cancellation quietly and retries it with a reason', async () => {
    const failed = {
      status: 'failed' as const,
      attempts: 5,
      lastError: 'No such subscription: sub_123',
      date: { created: '2026-11-28T10:00:00.000Z', modified: '2026-11-28T11:00:00.000Z' },
    };
    const root = await open(detail({ status: 'deleted', billingCancellation: failed }));
    const notice = el(root, 'billing-notice');
    expect(notice.textContent).toContain('The billing cancellation failed');
    expect(el(root, 'billing-attempts').textContent?.trim()).toBe('5');
    expect(el(root, 'billing-error').textContent).toContain('No such subscription: sub_123');
    expect(notice.classList).not.toContain('alert-danger');
    // The billing first, then the address
    const panels = Array.from(root.querySelectorAll('[data-test^="action-"]')).map(element => element.getAttribute('data-test'));
    expect(panels).toEqual(['action-retryBilling', 'action-release']);

    act(root, 'retryBilling', 'Subscription id fixed by billing');
    const req = http.expectOne(`${endpoint}/operator/organizations/o1/billing-cancellation`);
    expect(req.request.body).toEqual({ reason: 'Subscription id fixed by billing' });
    req.flush({ data: detail({ status: 'deleted', billingCancellation: { ...failed, status: 'done', attempts: 6, lastError: null } }) });
    harness.detectChanges();
    expect(q(root, 'billing-notice')).toBeNull();
    expect(q(root, 'action-retryBilling')).toBeNull();
  });

  it('shows a pending billing cancellation as still being tried', async () => {
    const root = await open(
      detail({
        status: 'deleted',
        billingCancellation: {
          status: 'pending',
          attempts: 1,
          lastError: null,
          date: { created: '2026-11-28T10:00:00.000Z', modified: '2026-11-28T10:05:00.000Z' },
        },
      }),
    );
    expect(el(root, 'billing-notice').textContent).toContain('The billing cancellation is pending');
    expect(q(root, 'billing-error')).toBeNull();
  });

  it('shows the status of now when another operator changed it meanwhile', async () => {
    const root = await open();
    act(root, 'suspend', 'Chargeback, account under review');
    http
      .expectOne(`${endpoint}/operator/organizations/o1/suspend`)
      .flush({ error: { code: 'organization_status', message: 'Not active' } }, { status: 409, statusText: 'Conflict' });
    http.expectOne(`${endpoint}/operator/organizations/o1`).flush({ data: detail({ status: 'suspended' }) });
    harness.detectChanges();
    expect(el(root, 'action-error').textContent).toContain('status changed meanwhile');
    expect(el(root, 'status').textContent?.trim()).toBe('suspended');
    expect(q(root, 'action-restore')).not.toBeNull();
  });

  it('says so for an unknown id', async () => {
    await harness.navigateByUrl('/operator/organizations/o1');
    http.expectOne(`${endpoint}/operator/organizations/o1`).flush({ error: { code: 'NotFound' } }, { status: 404, statusText: 'Not Found' });
    harness.detectChanges();
    expect(q(harness.routeNativeElement as HTMLElement, 'not-found')).not.toBeNull();
  });

  it('carries the list search back to the list, and nothing when it had none', async () => {
    await harness.navigateByUrl('/operator/organizations/o1?q=acme&billing=unsettled&page=2');
    http.expectOne(`${endpoint}/operator/organizations/o1`).flush({ data: detail() });
    harness.detectChanges();
    let root = harness.routeNativeElement as HTMLElement;
    expect(el(root, 'back').getAttribute('href')).toBe('/operator/organizations?q=acme&billing=unsettled&page=2');

    await harness.navigateByUrl('/operator/organizations/o2');
    http.expectOne(`${endpoint}/operator/organizations/o2`).flush({ data: detail({ id: 'o2' }) });
    harness.detectChanges();
    root = harness.routeNativeElement as HTMLElement;
    expect(el(root, 'back').getAttribute('href')).toBe('/operator/organizations');
  });

  it('drops a late answer to "Try again" once another organization is shown', async () => {
    await harness.navigateByUrl('/operator/organizations/o1');
    http.expectOne(`${endpoint}/operator/organizations/o1`).flush({ error: { code: 'Internal' } }, { status: 500, statusText: 'Server Error' });
    harness.detectChanges();
    const root = harness.routeNativeElement as HTMLElement;
    css(root, '.alert button').click();
    const retry = http.expectOne(`${endpoint}/operator/organizations/o1`);

    await harness.navigateByUrl('/operator/organizations/o2');
    expect(retry.cancelled).toBe(true);
    http.expectOne(`${endpoint}/operator/organizations/o2`).flush({ data: detail({ id: 'o2', name: 'Globex', slug: 'globex' }) });
    harness.detectChanges();
    const shown = harness.routeNativeElement as HTMLElement;
    expect(shown.textContent).toContain('Globex');
    expect(q(shown, 'not-found')).toBeNull();
  });
});
