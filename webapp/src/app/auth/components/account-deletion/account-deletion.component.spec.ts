import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { environment } from '../../../../environments/environment';
import { AccountDeletionPreflight } from '../../models/account-deletion';
import { AuthState } from '../../stores/auth.state';
import { AccountDeletionComponent } from './account-deletion.component';

describe('AccountDeletionComponent', () => {
  const endpoint = environment.apiEndpoint;
  const user = { id: 'u1', name: 'Ada', email: 'ada@example.test', emailVerified: true };
  let http: HttpTestingController;
  let store: Store;

  const preflight: AccountDeletionPreflight = {
    projects: [
      {
        id: 'p1',
        name: 'Website',
        organizationId: 'o1',
        members: [
          { userId: 'u2', name: 'Bob', email: 'bob@example.test', role: 'editor' },
          { userId: 'u3', name: 'Cy', email: 'cy@example.test', role: 'viewer' },
        ],
      },
    ],
    organizations: [
      {
        id: 'o1',
        name: 'Acme',
        slug: 'acme',
        status: 'active',
        projectsCount: 2,
        onlyMember: false,
        members: [{ userId: 'u2', name: 'Bob', email: 'bob@example.test', role: 'admin' }],
      },
      { id: 'o2', name: 'Side project', slug: 'side-project', status: 'active', projectsCount: 1, onlyMember: true, members: [] },
    ],
  };

  const q = (fixture: ComponentFixture<unknown>, selector: string) => fixture.nativeElement.querySelector(selector) as HTMLElement | null;

  /** The element, or a failure naming what is missing. */
  const el = (fixture: ComponentFixture<unknown>, selector: string): HTMLElement => {
    const found = q(fixture, selector);
    if (!found) {
      throw new Error(`Nothing matches ${selector}`);
    }
    return found;
  };

  const setValue = (fixture: ComponentFixture<unknown>, selector: string, value: string, event = 'input') => {
    const element = q(fixture, selector) as HTMLInputElement | HTMLSelectElement;
    element.value = value;
    element.dispatchEvent(new Event(event));
    fixture.detectChanges();
  };

  const open = (answer: AccountDeletionPreflight) => {
    const fixture = TestBed.createComponent(AccountDeletionComponent);
    fixture.componentRef.setInput('user', user);
    fixture.detectChanges();
    el(fixture, '[data-test="start"]').click();
    fixture.detectChanges();
    http.expectOne(`${endpoint}/users/me/deletion`).flush({ data: answer });
    fixture.detectChanges();
    return fixture;
  };

  const submit = (fixture: ComponentFixture<unknown>) => q(fixture, '[data-test="submit"]') as HTMLButtonElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AccountDeletionComponent, NgxsModule.forRoot([AuthState])],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(Store);
    store.reset({ ...store.snapshot(), auth: { ...store.snapshot().auth, user, isAuthenticated: true } });
  });

  afterEach(() => http.verify());

  it('asks nothing but the email when nothing stands in the way, and sends no body', () => {
    const fixture = open({ projects: [], organizations: [] });
    expect(q(fixture, '[data-test="project"]')).toBeNull();
    expect(q(fixture, '[data-test="owned"]')).toBeNull();
    expect(q(fixture, '[data-test="alone"]')).toBeNull();
    expect(submit(fixture).disabled).toBe(true);
    expect(submit(fixture).textContent?.trim()).toBe('Delete my account');

    setValue(fixture, '[data-test="email"]', 'someone@example.test');
    expect(submit(fixture).disabled).toBe(true);
    setValue(fixture, '[data-test="email"]', 'ada@example.test');
    expect(submit(fixture).disabled).toBe(false);
    submit(fixture).click();

    const req = http.expectOne(`${endpoint}/users/me`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toBeNull();
    req.flush(null, { status: 204, statusText: 'No Content' });
    expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(false);
  });

  it('asks for a new project admin, a new owner and the address of each organization deleted with the account', () => {
    const fixture = open(preflight);
    expect(el(fixture, '[data-test="project"]').textContent).toContain('Website');
    expect(el(fixture, '[data-test="owned"]').textContent).toContain('/orgs/acme');
    expect(el(fixture, '[data-test="alone"]').textContent).toContain('/orgs/side-project · 1 project');
    expect(el(fixture, '[data-test="alone"] a').getAttribute('href')).toBe('/orgs/side-project/settings');
    expect(submit(fixture).textContent?.trim()).toBe('Delete my account and 1 organization');

    setValue(fixture, '[data-test="email"]', 'ada@example.test');
    expect(submit(fixture).disabled).toBe(true);
    setValue(fixture, '#acctAdmin-p1', 'u3', 'change');
    setValue(fixture, '#acctOwner-o1', 'u2', 'change');
    expect(submit(fixture).disabled).toBe(true);
    setValue(fixture, '#acctSlug-o2', 'side');
    expect(submit(fixture).disabled).toBe(true);
    setValue(fixture, '#acctSlug-o2', 'side-project');
    expect(submit(fixture).disabled).toBe(false);
    submit(fixture).click();

    const req = http.expectOne(`${endpoint}/users/me`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({
      projectAdmins: [{ projectId: 'p1', userId: 'u3' }],
      organizationOwners: [{ organizationId: 'o1', userId: 'u2' }],
      deleteOrganizations: [{ organizationId: 'o2', slug: 'side-project' }],
    });
    req.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('shows a refusal by the form, and checks again on request', () => {
    const fixture = open({ projects: [], organizations: [preflight.organizations[0]] });
    setValue(fixture, '#acctOwner-o1', 'u2', 'change');
    setValue(fixture, '[data-test="email"]', 'ada@example.test');
    submit(fixture).click();
    http
      .expectOne(`${endpoint}/users/me`)
      .flush({ error: { code: 'owner_required', message: 'Owner required' } }, { status: 422, statusText: 'Unprocessable Entity' });
    fixture.detectChanges();

    expect(el(fixture, '[data-test="deletion-error"]').textContent).toContain('Choose a new owner for every organization');
    // Shown here only, not again at the top of the page
    expect(store.selectSnapshot(state => state.auth.errorMessage)).toBeUndefined();
    expect(store.selectSnapshot(AuthState.isAuthenticated)).toBe(true);

    (q(fixture, '[data-test="deletion-error"] button') as HTMLButtonElement).click();
    http.expectOne(`${endpoint}/users/me/deletion`).flush({ data: { projects: [], organizations: [] } });
    fixture.detectChanges();
    expect(q(fixture, '[data-test="owned"]')).toBeNull();
  });

  it('cancels back to the first step', () => {
    const fixture = open(preflight);
    (Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[]).find(b => b.textContent?.trim() === 'Cancel')?.click();
    fixture.detectChanges();
    expect(q(fixture, 'form')).toBeNull();
    expect(el(fixture, '[data-test="start"]').textContent?.trim()).toBe('Delete my account');
  });
  it('is blocked by a suspended organization: it says so, offers no choice for it, and cannot be sent', () => {
    const suspended = { ...preflight.organizations[1], status: 'suspended' as const };
    const fixture = open({ projects: [], organizations: [suspended] });
    expect(el(fixture, '[data-test="blocked"]').textContent).toContain('Side project is suspended. Contact support before deleting your account');
    expect(q(fixture, '[data-test="alone"]')).toBeNull();
    expect(q(fixture, '#acctSlug-o2')).toBeNull();
    setValue(fixture, '[data-test="email"]', 'ada@example.test');
    expect(submit(fixture).disabled).toBe(true);
    expect(submit(fixture).textContent?.trim()).toBe('Delete my account');
    fixture.componentInstance.submit();
    http.expectNone(`${endpoint}/users/me`);
  });

  it('keeps the form while the deletion is on its way: Cancel waits', () => {
    const fixture = open({ projects: [], organizations: [] });
    setValue(fixture, '[data-test="email"]', 'ada@example.test');
    submit(fixture).click();
    fixture.detectChanges();
    const req = http.expectOne(`${endpoint}/users/me`);
    expect((el(fixture, '[data-test="cancel"]') as HTMLButtonElement).disabled).toBe(true);
    fixture.componentInstance.cancel();
    fixture.detectChanges();
    expect(q(fixture, 'form')).not.toBeNull();
    req.flush({ error: { code: 'Internal' } }, { status: 500, statusText: 'Server Error' });
    fixture.detectChanges();
    expect((el(fixture, '[data-test="cancel"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('checks the typed email against the account shown now', () => {
    const fixture = open({ projects: [], organizations: [] });
    setValue(fixture, '[data-test="email"]', 'ada@example.test');
    expect(submit(fixture).disabled).toBe(false);

    fixture.componentRef.setInput('user', { ...user, email: 'ada.new@example.test' });
    fixture.detectChanges();
    expect(submit(fixture).disabled).toBe(true);
    setValue(fixture, '[data-test="email"]', 'ada.new@example.test');
    expect(submit(fixture).disabled).toBe(false);
  });
});
