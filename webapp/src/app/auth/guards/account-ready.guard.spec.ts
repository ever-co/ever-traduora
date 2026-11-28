import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { firstValueFrom, isObservable, Observable, of, throwError } from 'rxjs';
import { User } from '../models/user';
import { AuthService } from '../services/auth.service';
import { AuthState } from '../stores/auth.state';
import { accountReadyGuard } from './account-ready.guard';

describe('accountReadyGuard', () => {
  let auth: jasmine.SpyObj<AuthService>;

  const run = async (url: string) => {
    const result = TestBed.runInInjectionContext(() => accountReadyGuard({} as any, { url } as any));
    return isObservable(result) ? firstValueFrom(result as Observable<boolean | UrlTree>) : result;
  };
  const signedIn = (yes: boolean) => {
    const store = TestBed.inject(Store);
    store.reset({ ...store.snapshot(), auth: { ...store.snapshot().auth, isAuthenticated: yes } });
  };

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['getUserSelf']);
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([AuthState])],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: AuthService, useValue: auth }],
    });
  });

  it('sends a pending account to the page that finishes it, with the way back', async () => {
    signedIn(true);
    const router = TestBed.inject(Router);
    auth.getUserSelf.and.returnValue(of({ pending: 'email_not_verified' } as User));
    expect(router.serializeUrl((await run('/projects/p1')) as UrlTree)).toBe('/check-inbox?returnTo=%2Fprojects%2Fp1');
    auth.getUserSelf.and.returnValue(of({ pending: 'terms_not_accepted' } as User));
    expect(router.serializeUrl((await run('/orgs/acme/projects')) as UrlTree)).toBe('/accept-terms?returnTo=%2Forgs%2Facme%2Fprojects');
  });

  it('lets a ready account through, and the page load when the API does not answer', async () => {
    signedIn(true);
    auth.getUserSelf.and.returnValue(of({ pending: null } as User));
    expect(await run('/projects')).toBe(true);
    auth.getUserSelf.and.returnValue(throwError(() => new Error('down')));
    expect(await run('/projects')).toBe(true);
  });

  it('leaves a signed-out person to the sign-in guard', async () => {
    signedIn(false);
    expect(await run('/projects')).toBe(true);
    expect(auth.getUserSelf).not.toHaveBeenCalled();
  });
});
