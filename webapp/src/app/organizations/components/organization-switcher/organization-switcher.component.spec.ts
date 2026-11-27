import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { environment } from '../../../../environments/environment';
import { AuthState } from '../../../auth/stores/auth.state';
import { ProjectsState } from '../../../projects/stores/projects.state';
import { Organization } from '../../models/organization';
import { CURRENT_ORGANIZATION_KEY, OrganizationsState } from '../../stores/organizations.state';
import { OrganizationSwitcherComponent } from './organization-switcher.component';

describe('OrganizationSwitcherComponent', () => {
  const endpoint = environment.apiEndpoint;
  const user = { id: 'u1', name: 'Ada', email: 'ada@example.test', emailVerified: true };
  const acme: Organization = {
    id: 'o1',
    name: 'Acme Translations',
    slug: 'acme',
    status: 'active',
    planCode: 'starter',
    isDefault: false,
    adminsSeeAllProjects: true,
    role: 'owner',
  };
  const globex: Organization = { ...acme, id: 'o2', name: 'Globex', slug: 'globex', role: 'member' };

  let store: Store;
  let http: HttpTestingController;

  /** Renders the switcher for a signed-in person (or nobody) on an install in SaaS mode (or not). */
  const render = (options: { saas: boolean; signedIn?: boolean; organizations?: Organization[] }) => {
    store.reset({ ...store.snapshot(), auth: { ...store.snapshot().auth, user: options.signedIn === false ? undefined : user } });
    const fixture = TestBed.createComponent(OrganizationSwitcherComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: options.saas });
    fixture.detectChanges();
    if (options.saas && options.signedIn !== false) {
      http.expectOne(`${endpoint}/organizations`).flush({ data: options.organizations ?? [acme, globex] });
      fixture.detectChanges();
    }
    return fixture;
  };

  const text = (fixture: any) => (fixture.nativeElement.textContent as string).replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    try {
      window.localStorage.removeItem(CURRENT_ORGANIZATION_KEY);
    } catch {
      // storage blocked: nothing remembered anyway
    }
    TestBed.configureTestingModule({
      imports: [OrganizationSwitcherComponent, NgxsModule.forRoot([AuthState, ProjectsState, OrganizationsState])],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('renders nothing on a self-hosted install, and asks for no organizations', () => {
    const fixture = render({ saas: false });
    expect(text(fixture)).toBe('');
    http.expectNone(`${endpoint}/organizations`);
  });

  it('renders nothing for a signed-out visitor', () => {
    const fixture = render({ saas: true, signedIn: false });
    expect(text(fixture)).toBe('');
  });

  it('shows the current organization, the list with roles, and "New organization"', () => {
    const fixture = render({ saas: true });
    const trigger: HTMLButtonElement = fixture.nativeElement.querySelector('.org-trigger');
    expect(trigger.textContent).toContain('Acme Translations');
    trigger.click();
    fixture.detectChanges();
    const items = Array.from(fixture.nativeElement.querySelectorAll('.org-menu .org-item')).map((item: HTMLElement) => [
      item.querySelector('.org-item-name')?.textContent.trim(),
      item.querySelector('.org-item-role')?.textContent.trim() ?? '',
    ]);
    expect(items).toEqual([
      ['Acme Translations', 'owner'],
      ['Globex', 'member'],
      ['New organization', ''],
    ]);
    expect(fixture.nativeElement.querySelector('.org-item.is-current').getAttribute('aria-current')).toBe('true');
  });

  it('switches to another organization and remembers it for the next visit', () => {
    const fixture = render({ saas: true });
    const navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    fixture.nativeElement.querySelector('.org-trigger').click();
    fixture.detectChanges();
    const globexItem = Array.from(fixture.nativeElement.querySelectorAll('.org-menu button.org-item')).find((item: HTMLElement) =>
      item.textContent.includes('Globex'),
    ) as HTMLButtonElement;
    globexItem.click();
    fixture.detectChanges();
    expect(navigate).toHaveBeenCalledWith(['/orgs', 'globex', 'projects']);
    expect(store.selectSnapshot(OrganizationsState.currentOrganization)?.id).toBe('o2');
    expect(window.localStorage.getItem(CURRENT_ORGANIZATION_KEY)).toBe('o2');
    expect(fixture.nativeElement.querySelector('.org-trigger').textContent).toContain('Globex');
  });

  it("follows the project's organization on a project page", () => {
    const fixture = render({ saas: true });
    store.reset({
      ...store.snapshot(),
      projects: {
        ...store.snapshot().projects,
        currentProject: { id: 'p1', name: 'Site', role: 'viewer', termsCount: 0, localesCount: 0, organizationId: 'o2' },
      },
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.org-trigger').textContent).toContain('Globex');
  });

  it('offers to create an organization to a person who has none', () => {
    const fixture = render({ saas: true, organizations: [] });
    expect(fixture.nativeElement.querySelector('.org-trigger').textContent).toContain('No organization');
  });
});
