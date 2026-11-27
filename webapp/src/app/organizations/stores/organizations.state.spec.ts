import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { NgxsModule, Store } from '@ngxs/store';
import { environment } from '../../../environments/environment';
import { Logout } from '../../auth/stores/auth.state';
import { CreateOrganization, GetOrganizations, OrganizationsState } from './organizations.state';

describe('OrganizationsState', () => {
  const url = `${environment.apiEndpoint}/organizations`;
  const acme = { id: 'o1', name: 'Acme', slug: 'acme', role: 'owner' };
  const beta = { id: 'o2', name: 'Beta', slug: 'beta', role: 'owner' };
  let store: Store;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([OrganizationsState])],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it("drops the answer to a request sent before Logout: the next account never sees the previous one's organizations", () => {
    store.dispatch(new GetOrganizations());
    const pending = http.expectOne(url);
    store.dispatch(new Logout());
    pending.flush({ data: [acme] });
    expect(store.selectSnapshot(OrganizationsState.organizations)).toEqual([]);
    expect(store.selectSnapshot(OrganizationsState.loaded)).toBe(false);
  });

  it('reads the list again instead of applying one read before an organization was created', () => {
    store.dispatch(new GetOrganizations());
    const stale = http.expectOne(req => req.method === 'GET' && req.url === url);
    store.dispatch(new CreateOrganization('Beta', 'beta'));
    http.expectOne(req => req.method === 'POST' && req.url === url).flush({ data: beta });
    stale.flush({ data: [acme] });
    expect(store.selectSnapshot(OrganizationsState.organizations).map(o => o.id)).toEqual(['o2']);
    http.expectOne(req => req.method === 'GET' && req.url === url).flush({ data: [acme, beta] });
    expect(store.selectSnapshot(OrganizationsState.organizations).map(o => o.id)).toEqual(['o1', 'o2']);
  });
});
