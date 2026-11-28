import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { of, Subject, throwError } from 'rxjs';
import { User } from '../../models/user';
import { AuthService } from '../../services/auth.service';
import { CheckInboxComponent } from './check-inbox.component';

describe('CheckInboxComponent', () => {
  let auth: jasmine.SpyObj<AuthService>;
  let navigateByUrl: jasmine.Spy;
  let navigate: jasmine.Spy;
  const pending = { id: 'u1', name: 'Ada', email: 'ada@example.com', pending: 'email_not_verified' } as User;

  const create = (returnTo = '/projects/p1/terms') => {
    TestBed.configureTestingModule({
      imports: [CheckInboxComponent, NgxsModule.forRoot([])],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ returnTo }) } } },
      ],
    });
    spyOn(TestBed.inject(Store), 'dispatch').and.returnValue(of(undefined));
    navigateByUrl = spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
    navigate = spyOn(TestBed.inject(Router), 'navigate').and.resolveTo(true);
    const fixture = TestBed.createComponent(CheckInboxComponent);
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    auth = jasmine.createSpyObj<AuthService>('AuthService', ['getUserSelf', 'resendVerificationEmail', 'updateUserSelf']);
    localStorage.setItem('accessToken', 'session-1');
  });

  afterEach(() => localStorage.removeItem('accessToken'));

  it('drops an answer that arrives after a sign-out or another sign-in (bot review of #679)', () => {
    const answer = new Subject<User>();
    auth.getUserSelf.and.returnValue(answer);
    const fixture = create();
    localStorage.setItem('accessToken', 'session-2');
    answer.next({ ...pending, pending: null, email: 'someone-else@example.com' });
    fixture.detectChanges();
    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(TestBed.inject(Store).dispatch).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('someone-else@example.com');
  });

  it('shows the address the link went to, and sends a new link', () => {
    auth.getUserSelf.and.returnValue(of(pending));
    auth.resendVerificationEmail.and.returnValue(of(''));
    const fixture = create();
    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('[data-test="address"]').textContent.trim()).toBe('ada@example.com');
    expect(navigateByUrl).not.toHaveBeenCalled();

    fixture.componentInstance.resend();
    fixture.detectChanges();
    expect(auth.resendVerificationEmail).toHaveBeenCalledTimes(1);
    expect(page.textContent).toContain('We sent a new link to ada@example.com');
  });

  it('says so when the address is not confirmed yet, and goes on once it is', () => {
    auth.getUserSelf.and.returnValue(of(pending));
    const fixture = create();
    fixture.componentInstance.confirmed();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Not confirmed yet');

    auth.getUserSelf.and.returnValue(of({ ...pending, pending: null }));
    fixture.componentInstance.confirmed();
    expect(navigateByUrl).toHaveBeenCalledWith('/projects/p1/terms');
  });

  it('goes to the terms next when they wait too', () => {
    auth.getUserSelf.and.returnValue(of({ ...pending, pending: 'terms_not_accepted' }));
    create();
    expect(navigate).toHaveBeenCalledWith(['/accept-terms'], { queryParams: { returnTo: '/projects/p1/terms' } });
  });

  it('sends the link to a corrected address', () => {
    auth.getUserSelf.and.returnValue(of(pending));
    auth.updateUserSelf.and.returnValue(of({ ...pending, email: 'ada@example.org' }));
    const fixture = create();
    fixture.componentInstance.startChange();
    fixture.componentInstance.emailForm.setValue({ email: 'ada@example.org' });
    fixture.componentInstance.saveEmail();
    fixture.detectChanges();
    expect(auth.updateUserSelf).toHaveBeenCalledWith({ email: 'ada@example.org' });
    expect(fixture.nativeElement.querySelector('[data-test="address"]').textContent.trim()).toBe('ada@example.org');
  });

  it('says nothing was sent when the address is the same (bot review of #679)', () => {
    auth.getUserSelf.and.returnValue(of(pending));
    auth.updateUserSelf.and.returnValue(of(pending));
    const fixture = create();
    fixture.componentInstance.startChange();
    fixture.componentInstance.emailForm.setValue({ email: 'ada@example.com' });
    fixture.componentInstance.saveEmail();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('is already the address of your account');
    expect(fixture.nativeElement.textContent).not.toContain('We sent a link');
  });

  it('never goes back to an address outside the app', () => {
    auth.getUserSelf.and.returnValue(of({ ...pending, pending: null }));
    create('https://evil.example/');
    expect(navigateByUrl).toHaveBeenCalledWith('/');
  });

  it('shows an error of the API, such as too many links', () => {
    auth.getUserSelf.and.returnValue(of(pending));
    auth.resendVerificationEmail.and.returnValue(throwError(() => ({ status: 429, error: {} })));
    const fixture = create();
    fixture.componentInstance.resend();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.alert-danger')).not.toBeNull();
  });
});
