import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, RouterStateSnapshot, UrlTree } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { firstValueFrom, isObservable, Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthState } from '../../auth/stores/auth.state';
import { operatorGuard } from './operator.guard';

describe('operatorGuard', () => {
  const endpoint = environment.apiEndpoint;
  let http: HttpTestingController;
  let store: Store;

  const run = (): Promise<boolean | UrlTree> =>
    TestBed.runInInjectionContext(() => {
      const result = operatorGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot);
      return isObservable(result) ? firstValueFrom(result as Observable<boolean | UrlTree>) : Promise.resolve(result as boolean | UrlTree);
    });

  const url = (result: boolean | UrlTree) => (result instanceof UrlTree ? result.toString() : result);

  const signIn = (isAuthenticated: boolean) => store.reset({ ...store.snapshot(), auth: { ...store.snapshot().auth, isAuthenticated } });

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([AuthState])],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    store = TestBed.inject(Store);
  });

  afterEach(() => http.verify());

  it('opens the operator pages to an operator', async () => {
    signIn(true);
    const result = run();
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: true });
    http.expectOne(`${endpoint}/operator/status`).flush({ data: { operator: true } });
    expect(await result).toBe(true);
  });

  it('sends anyone else to the not-found page', async () => {
    signIn(true);
    const result = run();
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: true });
    http.expectOne(`${endpoint}/operator/status`).flush({ error: { code: 'NotFound' } }, { status: 404, statusText: 'Not Found' });
    expect(url(await result)).toBe('/404');
  });

  it('sends everyone to the not-found page on a self-hosted install', async () => {
    signIn(true);
    const result = run();
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: [], saas: false });
    expect(url(await result)).toBe('/404');
  });

  it('asks nothing while signed out (the sign-in guard takes over)', async () => {
    signIn(false);
    expect(await run()).toBe(false);
    http.expectNone(`${endpoint}/operator/status`);
  });
});
