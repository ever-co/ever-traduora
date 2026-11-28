import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { environment } from '../../../../environments/environment';
import { AuthState } from '../../../auth/stores/auth.state';
import { Organization, OrganizationInvite, OrganizationMember, OrganizationUsage } from '../../models/organization';
import { OrganizationsState } from '../../stores/organizations.state';
import { OrganizationMembersComponent } from './organization-members.component';

describe('OrganizationMembersComponent', () => {
  const endpoint = environment.apiEndpoint;
  const organization: Organization = {
    id: 'o1',
    name: 'Acme Translations',
    slug: 'acme',
    status: 'active',
    planCode: 'starter',
    isDefault: false,
    adminsSeeAllProjects: true,
    role: 'owner',
  };
  const owner: OrganizationMember = { userId: 'u1', name: 'Ada', email: 'ada@example.test', role: 'owner' };
  const member: OrganizationMember = { userId: 'u2', name: 'Bo', email: 'bo@example.test', role: 'member' };
  const pending: OrganizationInvite = { id: 'i1', email: 'cy@example.test', role: 'admin', status: 'sent' };
  const usage: OrganizationUsage = {
    plan: { code: 'starter', name: 'Starter' },
    seats: { used: 3, included: 15 },
    strings: { used: 9_990, limit: 10_000 },
  };
  const flushUsage = (data: OrganizationUsage = usage) => http.expectOne(`${endpoint}/organizations/o1/usage`).flush({ data });

  let store: Store;
  let http: HttpTestingController;

  const render = (role: Organization['role'], self = owner) => {
    store.reset({
      ...store.snapshot(),
      auth: { ...store.snapshot().auth, user: { id: self.userId, name: self.name, email: self.email, emailVerified: true } },
      organizations: { ...store.snapshot().organizations, organizations: [{ ...organization, role }], loaded: true, currentOrganizationId: 'o1' },
    });
    const fixture = TestBed.createComponent(OrganizationMembersComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/organizations/o1/members`).flush({ data: [owner, member] });
    if (role !== 'member') {
      http.expectOne(`${endpoint}/organizations/o1/invites`).flush({ data: [pending] });
      flushUsage();
    }
    fixture.detectChanges();
    return fixture;
  };

  const rows = (fixture: any, kind: 'member' | 'invite') =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-test="${kind}"]`)) as HTMLElement[];

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [OrganizationMembersComponent, NgxsModule.forRoot([AuthState, OrganizationsState])],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists no members of the default organization, and asks the API for none', () => {
    store.reset({
      ...store.snapshot(),
      auth: { ...store.snapshot().auth, user: { id: owner.userId, name: owner.name, email: owner.email, emailVerified: true } },
      organizations: {
        ...store.snapshot().organizations,
        organizations: [{ ...organization, isDefault: true }],
        loaded: true,
        currentOrganizationId: 'o1',
      },
    });
    const fixture = TestBed.createComponent(OrganizationMembersComponent);
    fixture.detectChanges();
    http.expectNone(`${endpoint}/organizations/o1/members`);
    expect(fixture.nativeElement.querySelector('[data-test="default-organization"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('form.org-invite')).toBeNull();
  });

  it('offers a retry when the lists cannot be loaded, and loads them again', () => {
    store.reset({
      ...store.snapshot(),
      auth: { ...store.snapshot().auth, user: { id: owner.userId, name: owner.name, email: owner.email, emailVerified: true } },
      organizations: { ...store.snapshot().organizations, organizations: [organization], loaded: true, currentOrganizationId: 'o1' },
    });
    const fixture = TestBed.createComponent(OrganizationMembersComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/organizations/o1/members`).flush('down', { status: 503, statusText: 'Unavailable' });
    for (const url of [`${endpoint}/organizations/o1/invites`, `${endpoint}/organizations/o1/usage`]) {
      http
        .match(url)
        .filter(req => !req.cancelled)
        .forEach(req => req.flush({ data: url.endsWith('usage') ? usage : [] }));
    }
    fixture.detectChanges();
    const retry = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button: HTMLButtonElement) => button.textContent.trim() === 'Try again',
    ) as HTMLButtonElement;
    expect(retry).toBeTruthy();
    retry.click();
    http.expectOne(`${endpoint}/organizations/o1/members`).flush({ data: [owner, member] });
    http.expectOne(`${endpoint}/organizations/o1/invites`).flush({ data: [] });
    flushUsage();
    fixture.detectChanges();
    expect(rows(fixture, 'member').length).toBe(2);
  });

  it('counts the seats: members plus pending invites', () => {
    const fixture = render('owner');
    expect(fixture.nativeElement.querySelector('[data-test="seats"]').textContent.trim()).toBe('2 members · 1 pending invite');
    expect(rows(fixture, 'member').length).toBe(2);
    expect(rows(fixture, 'invite')[0].textContent).toContain('cy@example.test');
  });

  it('lets the owner change roles and remove members, never the owner row', () => {
    const fixture = render('owner');
    const [ownerRow, memberRow] = rows(fixture, 'member');
    expect(ownerRow.querySelector('select')).toBeNull();
    expect(ownerRow.textContent).toContain('(you)');
    const select: HTMLSelectElement = memberRow.querySelector('select');
    select.value = 'admin';
    select.dispatchEvent(new Event('change'));
    const patch = http.expectOne(`${endpoint}/organizations/o1/members/u2`);
    expect(patch.request.method).toBe('PATCH');
    expect(patch.request.body).toEqual({ role: 'admin' });
    patch.flush({ data: { ...member, role: 'admin' } });

    (memberRow.querySelector('button[aria-label="Remove Bo"]') as HTMLButtonElement).click();
    http.expectOne(req => req.method === 'DELETE' && req.url === `${endpoint}/organizations/o1/members/u2`).flush(null);
    // The seat is free again
    flushUsage({ ...usage, seats: { used: 2, included: 15 } });
    fixture.detectChanges();
    expect(rows(fixture, 'member').length).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-test="usage-seats"]').textContent).toContain('2 of 15');
  });

  it('invites by email and shows the link of a new invite', () => {
    const fixture = render('admin');
    const form = fixture.componentInstance.form;
    form.setValue({ email: 'dee@example.test', role: 'member' });
    fixture.detectChanges();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form.org-invite button[type="submit"]').click();
    const post = http.expectOne(`${endpoint}/organizations/o1/invites`);
    expect(post.request.body).toEqual({ email: 'dee@example.test', role: 'member' });
    post.flush({
      data: { id: 'i2', email: 'dee@example.test', role: 'member', status: 'sent', inviteUrl: 'http://localhost/signup?invite=t&kind=organization' },
    });
    flushUsage({ ...usage, seats: { used: 4, included: 15 } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.org-link input').value).toContain('invite=t');
    expect(fixture.nativeElement.querySelector('[data-test="seats"]').textContent.trim()).toBe('2 members · 2 pending invites');
  });

  it('shows the owner and the admins the plan, its seats and its strings', () => {
    const fixture = render('admin');
    const panel: HTMLElement = fixture.nativeElement.querySelector('[data-test="usage"]');
    expect(panel.querySelector('h6').textContent.trim()).toBe('Starter plan');
    expect(panel.querySelector('[data-test="usage-seats"]').textContent).toContain('3 of 15');
    expect(panel.querySelector('[data-test="usage-strings"]').textContent).toContain('9,990 of 10,000');
    const meters = Array.from(panel.querySelectorAll('progress')) as HTMLProgressElement[];
    expect(meters.map(meter => [meter.value, meter.max, meter.getAttribute('aria-valuetext')])).toEqual([
      [3, 15, '3 of 15'],
      [9_990, 10_000, '9,990 of 10,000'],
    ]);
    expect(meters.map(meter => meter.classList.contains('org-meter-full'))).toEqual([false, false]);
  });

  it('keeps a meter within its range over the limit, and says the real figure', () => {
    const fixture = render('owner');
    fixture.componentInstance.usage = { ...usage, seats: { used: 20, included: 15 } };
    fixture.detectChanges();
    const seats: HTMLProgressElement = fixture.nativeElement.querySelector('[data-test="usage-seats"] progress');
    expect([seats.value, seats.max, seats.getAttribute('aria-valuetext')]).toEqual([15, 15, '20 of 15']);
    expect(seats.classList.contains('org-meter-full')).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-test="usage-seats"]').textContent).toContain('20 of 15');
  });

  it('still lists the members and the invites when the usage cannot be read', () => {
    store.reset({
      ...store.snapshot(),
      auth: { ...store.snapshot().auth, user: { id: owner.userId, name: owner.name, email: owner.email, emailVerified: true } },
      organizations: { ...store.snapshot().organizations, organizations: [organization], loaded: true, currentOrganizationId: 'o1' },
    });
    const fixture = TestBed.createComponent(OrganizationMembersComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/organizations/o1/usage`).flush('down', { status: 503, statusText: 'Unavailable' });
    http.expectOne(`${endpoint}/organizations/o1/members`).flush({ data: [owner, member] });
    http.expectOne(`${endpoint}/organizations/o1/invites`).flush({ data: [pending] });
    fixture.detectChanges();
    expect(rows(fixture, 'member').length).toBe(2);
    expect(rows(fixture, 'invite').length).toBe(1);
    expect(fixture.nativeElement.querySelector('[data-test="usage"]')).toBeNull();
    expect(fixture.componentInstance.errorMessage).toBeUndefined();
  });

  it('drops a usage read that answers after the person stopped being an owner or admin', () => {
    const fixture = render('owner');
    const component = fixture.componentInstance;
    (component as unknown as { refreshUsage(): void }).refreshUsage();
    component.organization = { ...organization, role: 'member' };
    component.usage = undefined;
    flushUsage();
    fixture.detectChanges();
    expect(component.usage).toBeUndefined();
    expect(fixture.nativeElement.querySelector('[data-test="usage"]')).toBeNull();
  });

  it('shows the latest usage read, whatever order the answers come in', () => {
    const fixture = render('owner');
    const component = fixture.componentInstance as unknown as { refreshUsage(): void };
    component.refreshUsage();
    component.refreshUsage();
    const [older, newer] = http.match(`${endpoint}/organizations/o1/usage`);
    newer.flush({ data: { ...usage, seats: { used: 5, included: 15 } } });
    older.flush({ data: { ...usage, seats: { used: 4, included: 15 } } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-test="usage-seats"]').textContent).toContain('5 of 15');
  });

  it('shows no limit on a plan without one', () => {
    const fixture = render('owner');
    fixture.componentInstance.usage = {
      plan: { code: 'enterprise', name: 'Enterprise' },
      seats: { used: 40, included: null },
      strings: { used: 120_000, limit: null },
    };
    fixture.detectChanges();
    const panel: HTMLElement = fixture.nativeElement.querySelector('[data-test="usage"]');
    expect(panel.querySelector('[data-test="usage-seats"]').textContent).toContain('40, no limit');
    expect(panel.querySelector('[data-test="usage-strings"]').textContent).toContain('120,000, no limit');
    expect(panel.querySelectorAll('progress').length).toBe(0);
  });

  it('says what the plan allows when an invite is refused by its limit, and reads the usage again', () => {
    const fixture = render('owner');
    fixture.componentInstance.form.setValue({ email: 'dee@example.test', role: 'member' });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('form.org-invite button[type="submit"]').click();
    http.expectOne(`${endpoint}/organizations/o1/invites`).flush(
      {
        error: {
          code: 'plan_limit_reached',
          message: 'Your plan allows 15 members. Upgrade to add more.',
          resource: 'seats',
          limit: 15,
          used: 15,
          plan: 'starter',
        },
      },
      { status: 402, statusText: 'Payment Required' },
    );
    flushUsage({ ...usage, seats: { used: 15, included: 15 } });
    fixture.detectChanges();
    const notice: HTMLElement = fixture.nativeElement.querySelector('[data-test="plan-limit"]');
    expect(notice.textContent.replace(/\s+/g, ' ').trim()).toBe('Your plan allows 15 members. Upgrade to add more. See the plans');
    // The upgrade is on the billing page (P4)
    expect(notice.querySelector('[data-test="plan-limit-billing"]').getAttribute('href')).toBe('/orgs/acme/billing');
    expect(notice.classList.contains('alert-danger')).toBe(false);
    expect(fixture.nativeElement.querySelector('[data-test="usage-seats"] progress').classList.contains('org-meter-full')).toBe(true);
  });

  it('shows a member the list without any way to change it, and lets them leave', () => {
    const fixture = render('member', member);
    expect(fixture.nativeElement.querySelector('[data-test="usage"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('form.org-invite')).toBeNull();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(rows(fixture, 'invite').length).toBe(0);
    const leave = rows(fixture, 'member')[1].querySelector('button') as HTMLButtonElement;
    expect(leave.textContent.trim()).toBe('Leave');
    expect(rows(fixture, 'member')[0].querySelector('button')).toBeNull();
  });
});
