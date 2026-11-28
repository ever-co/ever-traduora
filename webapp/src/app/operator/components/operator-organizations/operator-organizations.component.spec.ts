import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting, TestRequest } from '@angular/common/http/testing';
import { ComponentFixture, fakeAsync, flush, TestBed, tick } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { environment } from '../../../../environments/environment';
import { OperatorOrganization } from '../../models/operator';
import { OperatorOrganizationsComponent } from './operator-organizations.component';

describe('OperatorOrganizationsComponent', () => {
  const endpoint = environment.apiEndpoint;
  let http: HttpTestingController;
  let router: Router;

  const organization = (n: number, extra: Partial<OperatorOrganization> = {}): OperatorOrganization => ({
    id: `o${n}`,
    name: `Organization ${n}`,
    slug: `org-${n}`,
    status: 'active',
    planCode: 'starter',
    isDefault: false,
    owner: { userId: `u${n}`, name: `Owner ${n}`, email: `owner${n}@example.test` },
    membersCount: 3,
    projectsCount: 2,
    seatsUsed: 4,
    stringsUsed: 12_400,
    date: { created: '2026-11-28T10:00:00.000Z', modified: '2026-11-28T10:00:00.000Z' },
    billingCancellation: null,
    ...extra,
  });

  const expectList = (): TestRequest => http.expectOne(request => request.url === `${endpoint}/operator/organizations`);

  const answer = (req: TestRequest, rows: OperatorOrganization[], total = rows.length, page = 1) =>
    req.flush({ data: rows, meta: { total, page, limit: 25 } });

  const rows = (fixture: ComponentFixture<OperatorOrganizationsComponent>) =>
    Array.from(fixture.nativeElement.querySelectorAll('[data-test="organization"]')) as HTMLElement[];

  const text = (fixture: ComponentFixture<OperatorOrganizationsComponent>, selector: string) =>
    (fixture.nativeElement.querySelector(selector)?.textContent ?? '').trim();

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OperatorOrganizationsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
  });

  afterEach(() => http.verify());

  it('lists the organizations with their slug in mono, status, owner and figures', () => {
    spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(OperatorOrganizationsComponent);
    fixture.detectChanges();
    const req = expectList();
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.get('limit')).toBe('25');
    expect(req.request.params.has('q')).toBe(false);
    answer(req, [organization(1), organization(2, { status: 'suspended', owner: null, isDefault: false })]);
    fixture.detectChanges();

    const [first, second] = rows(fixture);
    expect(first.textContent).toContain('Organization 1');
    expect(first.querySelector('.op-sub')?.textContent).toContain('/orgs/org-1');
    expect(first.textContent).toContain('owner1@example.test');
    expect(first.textContent).toContain('12,400');
    expect(first.textContent).toContain('28 Nov 2026');
    expect(second.querySelector('[data-test="status"]')?.classList).toContain('op-status-suspended');
    expect(second.textContent).toContain('No owner');
    expect(text(fixture, '[data-test="count"]')).toBe('2 organizations');
    expect(fixture.nativeElement.querySelector('ngb-pagination')).toBeNull();
  });

  it('searches as the operator types, once they pause, from the first page', fakeAsync(() => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(OperatorOrganizationsComponent);
    fixture.detectChanges();
    answer(expectList(), [organization(1)], 60);
    fixture.detectChanges();

    const input: HTMLInputElement = fixture.nativeElement.querySelector('#opSearch');
    input.value = 'ac';
    input.dispatchEvent(new Event('input'));
    tick(100);
    input.value = ' acme ';
    input.dispatchEvent(new Event('input'));
    tick(299);
    http.expectNone(request => request.url === `${endpoint}/operator/organizations`);
    tick(1);

    const req = expectList();
    expect(req.request.params.get('q')).toBe('acme');
    expect(req.request.params.get('page')).toBe('1');
    expect(navigate).toHaveBeenCalledWith(
      [],
      jasmine.objectContaining({ queryParams: { q: 'acme', status: null, billing: null, page: null }, replaceUrl: true }),
    );
    answer(req, [organization(3, { name: 'Acme' })]);
    fixture.detectChanges();
    expect(rows(fixture)).toHaveSize(1);
    expect(text(fixture, '[data-test="count"]')).toBe('1 organization found');
    flush();
  }));

  it('filters by status', () => {
    spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(OperatorOrganizationsComponent);
    fixture.detectChanges();
    answer(expectList(), [organization(1)]);
    fixture.detectChanges();

    const select: HTMLSelectElement = fixture.nativeElement.querySelector('#opStatus');
    select.value = 'suspended';
    select.dispatchEvent(new Event('change'));
    const req = expectList();
    expect(req.request.params.get('status')).toBe('suspended');
    answer(req, []);
    fixture.detectChanges();
    expect(text(fixture, '[data-test="empty"]')).toContain('No organization matches');
  });

  it('pages through the list, and drops the answer to an older page', fakeAsync(() => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(OperatorOrganizationsComponent);
    fixture.detectChanges();
    answer(
      expectList(),
      Array.from({ length: 25 }, (_, i) => organization(i + 1)),
      60,
    );
    fixture.detectChanges();
    expect(text(fixture, '[data-test="count"]')).toBe('60 organizations');

    const pageLink = (label: string) =>
      (Array.from(fixture.nativeElement.querySelectorAll('ngb-pagination .page-link')) as HTMLElement[]).find(link =>
        link.textContent?.trim().startsWith(label),
      );
    const two = pageLink('2');
    expect(two).toBeDefined();
    two?.click();
    // The pagination tells its page change a tick later
    tick();
    const second = expectList();
    expect(second.request.params.get('page')).toBe('2');
    expect(navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { q: null, status: null, billing: null, page: 2 } }));

    // Page 3 asked before page 2 answered: only page 3 is shown
    fixture.componentInstance.goTo(3);
    const third = expectList();
    expect(second.cancelled).toBe(true);
    answer(third, [organization(51)], 60, 3);
    fixture.detectChanges();
    expect(rows(fixture).map(row => row.querySelector('.op-name')?.textContent?.trim())).toEqual(['Organization 51']);
    flush();
  }));

  it('starts from the search, status and page in the address', async () => {
    await router.navigateByUrl('/?q=acme&status=suspended&page=2');
    const fixture = TestBed.createComponent(OperatorOrganizationsComponent);
    fixture.detectChanges();
    const req = expectList();
    expect(req.request.params.get('q')).toBe('acme');
    expect(req.request.params.get('status')).toBe('suspended');
    expect(req.request.params.get('page')).toBe('2');
    answer(req, [], 0, 2);
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('#opSearch') as HTMLInputElement).value).toBe('acme');
  });

  it('says what failed and tries again', () => {
    spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(OperatorOrganizationsComponent);
    fixture.detectChanges();
    expectList().flush({ error: { code: 'Internal' } }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="error"]')).not.toBeNull();
    (fixture.nativeElement.querySelector('[data-test="error"] button') as HTMLButtonElement).click();
    answer(expectList(), [organization(1)]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="error"]')).toBeNull();
    expect(rows(fixture)).toHaveSize(1);
  });

  it("never shows an earlier query's rows under a failed one", () => {
    spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(OperatorOrganizationsComponent);
    fixture.detectChanges();
    answer(expectList(), [organization(1)]);
    fixture.detectChanges();
    fixture.componentInstance.setStatus('deleted');
    expectList().flush({ error: { code: 'Internal' } }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect(rows(fixture)).toHaveSize(0);
    expect(text(fixture, '[data-test="count"]')).toBe('');
  });

  it('filters by an unsettled billing cancellation, and marks those rows', () => {
    const navigate = spyOn(router, 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(OperatorOrganizationsComponent);
    fixture.detectChanges();
    answer(expectList(), [organization(1)]);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="billing"]')).toBeNull();

    const box: HTMLInputElement = fixture.nativeElement.querySelector('#opBilling');
    box.click();
    const req = expectList();
    expect(req.request.params.get('billing')).toBe('unsettled');
    expect(navigate).toHaveBeenCalledWith([], jasmine.objectContaining({ queryParams: { q: null, status: null, billing: 'unsettled', page: null } }));
    answer(req, [
      organization(7, { status: 'deleted', billingCancellation: 'failed' }),
      organization(8, { status: 'deleted', billingCancellation: 'pending' }),
    ]);
    fixture.detectChanges();
    const [failed, pending] = rows(fixture);
    expect(failed.querySelector('[data-test="billing"]')?.textContent?.trim()).toBe('billing failed');
    expect(failed.querySelector('[data-test="billing"]')?.classList).toContain('op-billing-failed');
    expect(pending.querySelector('[data-test="billing"]')?.textContent?.trim()).toBe('billing pending');
    expect(pending.querySelector('[data-test="billing"]')?.classList).not.toContain('op-billing-failed');

    box.click();
    expect(expectList().request.params.has('billing')).toBe(false);
  });

  it('carries the search, filters and page to each organization, and nothing when unfiltered', async () => {
    await router.navigateByUrl('/?q=acme&billing=unsettled&page=2');
    const filtered = TestBed.createComponent(OperatorOrganizationsComponent);
    filtered.detectChanges();
    answer(expectList(), [organization(1)], 30, 2);
    filtered.detectChanges();
    const link = rows(filtered)[0].querySelector('a.op-name') as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/operator/organizations/o1?q=acme&billing=unsettled&page=2');
    filtered.destroy();

    await router.navigateByUrl('/');
    const bare = TestBed.createComponent(OperatorOrganizationsComponent);
    bare.detectChanges();
    answer(expectList(), [organization(1)]);
    bare.detectChanges();
    expect((rows(bare)[0].querySelector('a.op-name') as HTMLAnchorElement).getAttribute('href')).toBe('/operator/organizations/o1');
  });
});
