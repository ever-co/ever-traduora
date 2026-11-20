import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { environment } from '../../../../environments/environment';
import { Provider } from '../../../auth/models/provider';
import { AuthState, RedirectToAuthProvider } from '../../../auth/stores/auth.state';
import { PROVISION_INTENT_KEY, ProvisionIntent } from '../../services/provision.service';
import { PROVISION_PATH, ProvisionComponent } from './provision.component';

describe('ProvisionComponent', () => {
  let store: Store;
  let http: HttpTestingController;
  let fragment: string | null;
  const endpoint = environment.apiEndpoint;
  const base = `${endpoint}/ever-connect/provision`;
  const INTENT = 'eyJhbGciOiJFZERTQSJ9.eyJqdGkiOiJqMSJ9.c2ln';

  const everid: Provider = {
    slug: 'everid',
    url: 'https://idp.example.test/oauth/v2/authorize',
    redirectUrl: 'http://localhost:8080/auth/callback',
    clientId: 'c',
    scope: 'openid profile email',
    pkce: true,
  };
  const checked: ProvisionIntent = { provisionTxn: 'v1:sealed:txn:x', jti: 'j1', handle: 'acme', displayName: 'Acme Translations', expiresAt: 0 };

  /** Renders the page signed in or out, with the providers the API lists, and answers the intent check with `respond`. */
  const render = (signedIn: boolean, respond?: (req: any) => void, providers: Provider[] = [everid]): ComponentFixture<ProvisionComponent> => {
    store.reset({ ...store.snapshot(), auth: { ...store.snapshot().auth, isAuthenticated: signedIn } });
    const fixture = TestBed.createComponent(ProvisionComponent);
    fixture.detectChanges();
    http.expectOne(`${endpoint}/auth/providers`).flush({ data: providers });
    if (respond) {
      respond(http.expectOne(`${base}/intent`));
    }
    fixture.detectChanges();
    return fixture;
  };

  const text = (fixture: ComponentFixture<ProvisionComponent>) => fixture.nativeElement.textContent as string;
  const button = (fixture: ComponentFixture<ProvisionComponent>, label: string) =>
    fixture.debugElement.queryAll(By.css('button')).find(b => b.nativeElement.textContent.trim() === label);

  beforeEach(() => {
    fragment = `intent=${INTENT}`;
    sessionStorage.removeItem(PROVISION_INTENT_KEY);
    TestBed.configureTestingModule({
      declarations: [ProvisionComponent],
      imports: [NgxsModule.forRoot([AuthState])],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: ActivatedRoute,
          useValue: {
            get snapshot() {
              return { fragment };
            },
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    sessionStorage.removeItem(PROVISION_INTENT_KEY);
  });

  it('reads the intent from the address fragment, removes it from the address bar, and checks it', () => {
    const replaceState = spyOn(history, 'replaceState').and.callThrough();
    const fixture = render(true, req => {
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ intent: INTENT });
      req.flush({ data: checked });
    });
    expect(replaceState).toHaveBeenCalledTimes(1);
    expect(String(replaceState.calls.mostRecent().args[2])).not.toContain('intent=');
    expect(text(fixture)).toContain('Acme Translations');
    expect(text(fixture)).toContain('ever.co/acme');
    // Kept for this tab only, while the person signs in
    expect(JSON.parse(sessionStorage.getItem(PROVISION_INTENT_KEY)).intent).toBe(INTENT);
  });

  it('asks a signed-out person to continue with Ever ID, and comes back to this page', () => {
    const fixture = render(false, req => req.flush({ data: checked }));
    expect(button(fixture, 'Create')).toBeUndefined();
    const dispatch = spyOn(store, 'dispatch').and.stub();
    button(fixture, 'Continue with Ever ID').nativeElement.click();
    expect(dispatch).toHaveBeenCalledWith(new RedirectToAuthProvider(everid, { intent: 'signin', returnTo: PROVISION_PATH }));
  });

  it('uses the intent kept for this tab when it comes back from signing in', () => {
    fragment = null;
    sessionStorage.setItem(PROVISION_INTENT_KEY, JSON.stringify({ intent: INTENT, at: Date.now() }));
    const fixture = render(true, req => {
      expect(req.request.body).toEqual({ intent: INTENT });
      req.flush({ data: checked });
    });
    expect(button(fixture, 'Create')).toBeDefined();
  });

  it('creates the project once the person confirms, then offers to open it and go back', () => {
    const fixture = render(true, req => req.flush({ data: checked }));
    button(fixture, 'Create').nativeElement.click();
    const req = http.expectOne(`${base}/confirm`);
    expect(req.request.body).toEqual({ provisionTxn: checked.provisionTxn });
    req.flush({ data: { status: 'created', projectId: 'p1', returnTo: 'https://app.ever.test/start/done' } });
    fixture.detectChanges();
    expect(text(fixture)).toContain('The project was created, and you are its admin.');
    expect(fixture.debugElement.query(By.css('a[href="https://app.ever.test/start/done"]'))).not.toBeNull();
    expect(sessionStorage.getItem(PROVISION_INTENT_KEY)).toBeNull();
  });

  it('explains a confirmation from an account without that Ever ID, and offers to sign in with it', () => {
    const fixture = render(true, req => req.flush({ data: checked }));
    button(fixture, 'Create').nativeElement.click();
    http.expectOne(`${base}/confirm`).flush({ error: { code: 'intent_subject_mismatch' } }, { status: 403, statusText: 'Forbidden' });
    fixture.detectChanges();
    expect(text(fixture)).toContain('You are signed in with another account.');
    expect(button(fixture, 'Continue with Ever ID')).toBeDefined();
    // The link stays usable after signing in with the right Ever ID
    expect(sessionStorage.getItem(PROVISION_INTENT_KEY)).not.toBeNull();
  });

  it('declines through the reject route, signed in or not', () => {
    const fixture = render(false, req => req.flush({ data: checked }));
    button(fixture, 'Decline').nativeElement.click();
    const req = http.expectOne(`${base}/intents/j1/reject`);
    expect(req.request.body).toEqual({ provisionTxn: checked.provisionTxn });
    req.flush({ data: { status: 'refused', returnTo: null } });
    fixture.detectChanges();
    expect(text(fixture)).toContain('Nothing was created, and app.ever.co was told.');
    expect(sessionStorage.getItem(PROVISION_INTENT_KEY)).toBeNull();
  });

  it('says when the link expired, and forgets it', () => {
    const fixture = render(true, req => req.flush({ error: { code: 'intent_expired' } }, { status: 409, statusText: 'Conflict' }));
    expect(text(fixture)).toContain('This link has expired. Start again from app.ever.co.');
    expect(button(fixture, 'Create')).toBeUndefined();
    expect(sessionStorage.getItem(PROVISION_INTENT_KEY)).toBeNull();
  });

  it('says when provisioning is not available on this installation', () => {
    const fixture = render(true, req => req.flush({ error: { code: 'NotFound' } }, { status: 404, statusText: 'Not Found' }));
    expect(text(fixture)).toContain('not available on this Traduora installation');
  });

  it('asks for the link when there is none', () => {
    fragment = null;
    const fixture = render(true);
    expect(text(fixture)).toContain('Open this page from the link app.ever.co gave you.');
  });
});
