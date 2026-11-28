import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { of, throwError } from 'rxjs';
import { SaasModeService } from '../../../organizations/services/saas-mode.service';
import { TurnstileApi, TurnstileComponent, TurnstileLoader } from '../../../shared/components/turnstile/turnstile.component';
import { InstallationSettings } from '../../models/account-settings';
import { Signup } from '../../stores/auth.state';
import { SignupComponent } from './signup.component';

describe('SignupComponent', () => {
  const legal = {
    terms: { version: '1.1.0', url: 'https://traduora.co/tos' },
    privacy: { version: '1.0.2', url: 'https://traduora.co/privacy' },
  };
  let turnstile: jasmine.SpyObj<TurnstileApi>;
  let onToken: (token: string) => void;
  let dispatch: jasmine.Spy;

  const create = async (settings: InstallationSettings, outcome = of(undefined)) => {
    turnstile = jasmine.createSpyObj<TurnstileApi>('turnstile', ['render', 'reset', 'remove']);
    turnstile.render.and.callFake((_element, options) => {
      onToken = options.callback;
      return 'widget';
    });
    TestBed.configureTestingModule({
      declarations: [SignupComponent],
      imports: [ReactiveFormsModule, TurnstileComponent, NgxsModule.forRoot([])],
      providers: [
        provideRouter([]),
        { provide: SaasModeService, useValue: { saas$: of(settings.saas), settings$: of(settings) } },
        { provide: TurnstileLoader, useValue: { load: () => Promise.resolve(turnstile) } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    dispatch = spyOn(TestBed.inject(Store), 'dispatch').and.callFake((action: unknown) => (action instanceof Signup ? outcome : of(undefined)));
    const fixture = TestBed.createComponent(SignupComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.componentInstance.signupForm.patchValue({ name: 'Ada', email: 'ada@example.com', password: 'a-long-password' });
    fixture.detectChanges();
    return fixture;
  };
  const sentSignup = () =>
    dispatch.calls
      .allArgs()
      .map(([action]) => action)
      .find(action => action instanceof Signup) as Signup;

  it('asks for the terms and the bot check in SaaS mode, and sends the versions and the token with the sign-up', async () => {
    const fixture = await create({ saas: true, turnstileSiteKey: 'site-key', legal });
    const page: HTMLElement = fixture.nativeElement;
    const links = Array.from(page.querySelectorAll<HTMLAnchorElement>('.terms a')).map(link => [link.textContent.trim(), link.href]);
    expect(links).toEqual([
      ['terms of service', 'https://traduora.co/tos'],
      ['privacy policy', 'https://traduora.co/privacy'],
    ]);
    expect(fixture.componentInstance.ready).toBe(false);

    fixture.componentInstance.signupForm.patchValue({ acceptTerms: true });
    expect(fixture.componentInstance.ready).toBe(false);
    onToken('the-token');
    expect(fixture.componentInstance.ready).toBe(true);

    fixture.componentInstance.onSubmit();
    expect(sentSignup()).toEqual(new Signup('Ada', 'ada@example.com', 'a-long-password', undefined, undefined, '1.1.0', '1.0.2', 'the-token'));
  });

  it('asks for a fresh check after a refused sign-up', async () => {
    const fixture = await create(
      { saas: true, turnstileSiteKey: 'site-key', legal },
      throwError(() => new Error('refused')),
    );
    fixture.componentInstance.signupForm.patchValue({ acceptTerms: true });
    onToken('used-token');
    fixture.componentInstance.onSubmit();
    expect(turnstile.reset).toHaveBeenCalledWith('widget');
    expect(fixture.componentInstance.turnstileToken).toBeUndefined();
  });

  it('shows neither on a single-tenant install, and signs up as before', async () => {
    const fixture = await create({ saas: false });
    const page: HTMLElement = fixture.nativeElement;
    expect(page.querySelector('#acceptTermsInput')).toBeNull();
    expect(page.querySelector('app-turnstile')).toBeNull();
    expect(fixture.componentInstance.ready).toBe(true);
    fixture.componentInstance.onSubmit();
    expect(sentSignup()).toEqual(new Signup('Ada', 'ada@example.com', 'a-long-password', undefined, undefined, undefined, undefined, undefined));
  });
});
