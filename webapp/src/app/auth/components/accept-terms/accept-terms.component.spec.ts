import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { of, throwError } from 'rxjs';
import { SaasModeService } from '../../../organizations/services/saas-mode.service';
import { User } from '../../models/user';
import { AuthService } from '../../services/auth.service';
import { SetUserInfo } from '../../stores/auth.state';
import { AcceptTermsComponent } from './accept-terms.component';

describe('AcceptTermsComponent', () => {
  const legal = {
    terms: { version: '1.1.0', url: 'https://traduora.co/tos' },
    privacy: { version: '1.0.2', url: 'https://traduora.co/privacy' },
  };
  let auth: jasmine.SpyObj<AuthService>;
  let navigateByUrl: jasmine.Spy;

  const create = (user: Partial<User>, state: object = { status: 'loaded', settings: { saas: true, legal } }) => {
    auth.getUserSelf.and.returnValue(of({ id: 'u1', name: 'Ada', email: 'ada@example.com', ...user } as User));
    TestBed.configureTestingModule({
      imports: [AcceptTermsComponent, NgxsModule.forRoot([])],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: SaasModeService, useValue: { saas$: of(true), state$: of(state), reload: jasmine.createSpy('reload') } },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ returnTo: '/orgs/acme/projects' }) } } },
      ],
    });
    spyOn(TestBed.inject(Store), 'dispatch').and.returnValue(of(undefined));
    navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    const fixture = TestBed.createComponent(AcceptTermsComponent);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['getUserSelf', 'acceptTerms']);
  });

  it('lists both documents with their versions, and records the acceptance before going back', () => {
    auth.acceptTerms.and.returnValue(of(''));
    const fixture = create({ pending: 'terms_not_accepted', termsVersion: '1.0.2', privacyVersion: '1.0.2' });
    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('h4').textContent).toContain('Our terms have changed');
    expect(page.querySelector('[data-test="terms-version"]').textContent.trim()).toBe('1.1.0');
    expect(page.querySelector('[data-test="privacy-version"]').textContent.trim()).toBe('1.0.2');
    expect(page.querySelector<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);

    fixture.componentInstance.form.setValue({ accept: true });
    fixture.componentInstance.accept();
    expect(auth.acceptTerms).toHaveBeenCalledWith({ termsVersion: '1.1.0', privacyVersion: '1.0.2' });
    expect(navigateByUrl).toHaveBeenCalledWith('/orgs/acme/projects');
  });

  it('asks a first acceptance plainly, and says so when the terms changed meanwhile', () => {
    auth.acceptTerms.and.returnValue(throwError(() => ({ status: 400, error: { error: { code: 'terms_not_accepted' } } })));
    const fixture = create({ pending: 'terms_not_accepted', termsVersion: null, privacyVersion: null });
    expect(fixture.nativeElement.querySelector('h4').textContent).toContain('Accept the terms to continue');
    fixture.componentInstance.form.setValue({ accept: true });
    fixture.componentInstance.accept();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.alert-danger').textContent).toContain('Reload the page');
    expect(navigateByUrl).not.toHaveBeenCalled();
  });

  it('says when the documents cannot be loaded, offers to load them again, and keeps Continue off (bot review of #679)', () => {
    const fixture = create({ pending: 'terms_not_accepted' }, { status: 'failed' });
    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('.alert-danger').textContent).toContain('The documents could not be loaded');
    expect(page.querySelector<HTMLButtonElement>('button[type="submit"]').disabled).toBe(true);
    page.querySelector<HTMLButtonElement>('.alert-danger button').click();
    expect(TestBed.inject(SaasModeService).reload).toHaveBeenCalled();
  });

  it('stores the fresh profile, so the app bar hides for the pending account', () => {
    create({ pending: 'terms_not_accepted' });
    expect(TestBed.inject(Store).dispatch).toHaveBeenCalledWith(jasmine.any(SetUserInfo));
  });

  it('goes straight back when there is nothing to accept', () => {
    create({ pending: null });
    expect(navigateByUrl).toHaveBeenCalledWith('/orgs/acme/projects');
  });
});
