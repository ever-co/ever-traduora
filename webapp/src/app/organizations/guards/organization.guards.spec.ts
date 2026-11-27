import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, RouterStateSnapshot, UrlTree } from '@angular/router';
import { NgxsModule } from '@ngxs/store';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CURRENT_ORGANIZATION_KEY, OrganizationsState } from '../stores/organizations.state';
import { projectsRedirectGuard, saasGuard } from './organization.guards';

describe('organization guards', () => {
  const endpoint = environment.apiEndpoint;
  let http: HttpTestingController;

  const run = (guard: typeof saasGuard): Promise<boolean | UrlTree> =>
    TestBed.runInInjectionContext(() => {
      const result = guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot);
      return isObservable(result) ? firstValueFrom(result as Observable<boolean | UrlTree>) : Promise.resolve(result as boolean | UrlTree);
    });

  const url = (result: boolean | UrlTree) => (result instanceof UrlTree ? result.toString() : result);

  beforeEach(() => {
    try {
      window.localStorage.removeItem(CURRENT_ORGANIZATION_KEY);
    } catch {
      // storage blocked
    }
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([OrganizationsState])],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  it('keeps the organization pages to SaaS mode', async () => {
    const result = run(saasGuard);
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: false });
    expect(url(await result)).toBe('/projects');
  });

  it('opens the organization pages in SaaS mode', async () => {
    const result = run(saasGuard);
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: true });
    expect(await result).toBe(true);
  });

  it('keeps the project list of a self-hosted install', async () => {
    const result = run(projectsRedirectGuard);
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: false });
    expect(await result).toBe(true);
    http.expectNone(`${endpoint}/organizations`);
  });

  it("sends /projects to the current organization's list in SaaS mode, or to /orgs/new without one", async () => {
    const result = run(projectsRedirectGuard);
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: true });
    http.expectOne(`${endpoint}/organizations`).flush({ data: [{ id: 'o1', slug: 'acme', name: 'Acme', role: 'owner' }] });
    expect(url(await result)).toBe('/orgs/acme/projects');

    const none = run(projectsRedirectGuard);
    http.expectOne(`${endpoint}/organizations`).flush({ data: [] });
    expect(url(await none)).toBe('/orgs/new');
  });
});
