import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Store } from '@ngxs/store';
import { Provider } from '../../models/provider';
import { RedirectToAuthProvider } from '../../stores/auth.state';
import { SignInWithComponent } from './sign-in-with.component';

describe('SignInWithComponent', () => {
  let dispatch: jasmine.Spy;

  const render = (provider: Provider) => {
    const fixture = TestBed.createComponent(SignInWithComponent);
    fixture.componentInstance.provider = provider;
    fixture.detectChanges();
    return fixture;
  };

  beforeEach(() => {
    dispatch = jasmine.createSpy('dispatch');
    TestBed.configureTestingModule({
      declarations: [SignInWithComponent],
      providers: [{ provide: Store, useValue: { dispatch } }],
    });
  });

  it('shows "Continue with Ever ID" for Ever ID and starts its sign-in', () => {
    const provider: Provider = { slug: 'everid', url: 'https://idp.example.test/authorize', redirectUrl: '', clientId: 'c', pkce: true };
    const fixture = render(provider);
    const button = fixture.debugElement.query(By.css('button'));
    expect(button.nativeElement.textContent.trim()).toBe('Continue with Ever ID');
    expect(fixture.debugElement.query(By.css('img'))).toBeNull();

    button.nativeElement.click();
    expect(dispatch).toHaveBeenCalledOnceWith(new RedirectToAuthProvider(provider));
  });

  it('keeps the Google image button', () => {
    const fixture = render({ slug: 'google', url: 'https://accounts.google.com/o/oauth2/v2/auth', redirectUrl: '', clientId: 'c' });
    const image = fixture.debugElement.query(By.css('button img'));
    expect(image.nativeElement.getAttribute('src')).toBe('assets/img/signin-google/btn_google_signin_light_normal_web@2x.png');
    expect(fixture.nativeElement.textContent).not.toContain('Ever ID');
  });
});
