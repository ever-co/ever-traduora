import { HTTP_INTERCEPTORS, HttpClient, provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { ErrorInterceptor } from './error.interceptor';
import { GetUserInfo } from '../stores/auth.state';

describe('ErrorInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let navigate: jasmine.Spy;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [NgxsModule.forRoot([])],
      providers: [
        provideHttpClient(withInterceptorsFromDi()),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: HTTP_INTERCEPTORS, useClass: ErrorInterceptor, multi: true },
      ],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    spyOn(TestBed.inject(Store), 'dispatch');
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    spyOnProperty(TestBed.inject(Router), 'url').and.returnValue('/projects/p1/terms');
  });

  const refuse = (code: string) => {
    http.get('/api/v1/projects').subscribe({ error: () => undefined });
    backend.expectOne('/api/v1/projects').flush({ error: { code } }, { status: 403, statusText: 'Forbidden' });
  };

  it('sends a pending account to the page that finishes it, with the way back', () => {
    refuse('email_not_verified');
    expect(navigate).toHaveBeenCalledWith(['/check-inbox'], { queryParams: { returnTo: '/projects/p1/terms' } });
    // The stored profile is read again, so the app bar and the switcher hide
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(new GetUserInfo());
    refuse('terms_not_accepted');
    expect(navigate).toHaveBeenCalledWith(['/accept-terms'], { queryParams: { returnTo: '/projects/p1/terms' } });
  });

  it('leaves any other 403 to the page', () => {
    refuse('organization_suspended');
    expect(navigate).not.toHaveBeenCalled();
  });
});
