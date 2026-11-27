import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { environment } from '../../../../environments/environment';
import { AuthState } from '../../../auth/stores/auth.state';
import { Organization, OrganizationInvite, OrganizationMember } from '../../models/organization';
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
    fixture.detectChanges();
    expect(rows(fixture, 'member').length).toBe(1);
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
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.org-link input').value).toContain('invite=t');
    expect(fixture.nativeElement.querySelector('[data-test="seats"]').textContent.trim()).toBe('2 members · 2 pending invites');
  });

  it('shows a member the list without any way to change it, and lets them leave', () => {
    const fixture = render('member', member);
    expect(fixture.nativeElement.querySelector('form.org-invite')).toBeNull();
    expect(fixture.nativeElement.querySelector('select')).toBeNull();
    expect(rows(fixture, 'invite').length).toBe(0);
    const leave = rows(fixture, 'member')[1].querySelector('button') as HTMLButtonElement;
    expect(leave.textContent.trim()).toBe('Leave');
    expect(rows(fixture, 'member')[0].querySelector('button')).toBeNull();
  });
});
