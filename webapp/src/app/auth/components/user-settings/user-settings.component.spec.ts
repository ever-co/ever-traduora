import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { By } from '@angular/platform-browser';
import { NgxsModule, Store } from '@ngxs/store';
import { environment } from '../../../../environments/environment';
import { Provider } from '../../models/provider';
import { AuthState, ConfirmIdentityConnect, DeleteIdentity, RedirectToAuthProvider } from '../../stores/auth.state';
import { UserSettingsComponent } from './user-settings.component';

describe('UserSettingsComponent connected sign-in methods', () => {
  let store: Store;
  let http: HttpTestingController;
  const endpoint = environment.apiEndpoint;

  const everid: Provider = {
    slug: 'everid',
    url: 'https://idp.example.test/oauth/v2/authorize',
    redirectUrl: 'http://localhost:8080/auth/callback',
    clientId: 'c',
    scope: 'openid profile email',
    pkce: true,
  };
  const user = { id: 'u1', name: 'Member', email: 'member@example.test', emailVerified: true };

  /** Renders the settings with the providers the API lists and the identities it returns. */
  const render = (providers: Provider[], identities: unknown[] = [], pendingConnect?: unknown) => {
    store.reset({ ...store.snapshot(), auth: { ...store.snapshot().auth, user, isAuthenticated: true, pendingConnect } });
    const fixture = TestBed.createComponent(UserSettingsComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: providers });
    if (providers.some(provider => provider.slug === 'everid')) {
      http.expectOne(`${endpoint}/auth/identities`).flush({ data: identities });
    }
    fixture.detectChanges();
    return fixture;
  };

  const buttonWithText = (fixture: any, text: string) =>
    fixture.debugElement.queryAll(By.css('button')).find((button: any) => button.nativeElement.textContent.trim() === text);

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [UserSettingsComponent],
      imports: [ReactiveFormsModule, NgxsModule.forRoot([AuthState])],
      providers: [provideHttpClient(), provideHttpClientTesting()],
      schemas: [NO_ERRORS_SCHEMA],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
  });

  it('shows nothing about Ever ID while it is off', () => {
    const fixture = render([]);
    expect(fixture.nativeElement.textContent).not.toContain('Connected sign-in methods');
    http.expectNone(`${endpoint}/auth/identities`);
  });

  it('offers to connect Ever ID with a fresh sign-in', () => {
    const fixture = render([everid]);
    expect(fixture.nativeElement.textContent).toContain('Connected sign-in methods');
    const dispatch = spyOn(store, 'dispatch').and.stub();
    buttonWithText(fixture, 'Connect Ever ID').nativeElement.click();
    expect(dispatch).toHaveBeenCalledWith(new RedirectToAuthProvider(everid, { intent: 'connect' }));
  });

  it('shows both emails before connecting', () => {
    const fixture = render([everid], [], { pending: 'v1.sealed', emails: { account: 'member@example.test', everId: 'member.id@example.test' } });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('member@example.test');
    expect(text).toContain('member.id@example.test');
    expect(buttonWithText(fixture, 'Connect Ever ID')).toBeUndefined();
    const dispatch = spyOn(store, 'dispatch').and.stub();
    buttonWithText(fixture, 'Connect').nativeElement.click();
    expect(dispatch).toHaveBeenCalledWith(new ConfirmIdentityConnect());
  });

  it('lists the connected Ever ID and disconnects it after a confirmation', () => {
    const identity = { id: 'i1', provider: 'everid', email: 'member.id@example.test', linkMethod: 'explicit', linkedAt: '', lastLoginAt: null };
    const fixture = render([everid], [identity]);
    expect(fixture.nativeElement.textContent).toContain('member.id@example.test');
    expect(buttonWithText(fixture, 'Connect Ever ID')).toBeUndefined();
    spyOn(window, 'confirm').and.returnValue(true);
    const dispatch = spyOn(store, 'dispatch').and.stub();
    buttonWithText(fixture, 'Disconnect').nativeElement.click();
    expect(dispatch).toHaveBeenCalledWith(new DeleteIdentity('i1'));
  });
});
