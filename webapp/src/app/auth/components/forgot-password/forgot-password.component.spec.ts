import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { of } from 'rxjs';
import { SaasModeService } from '../../../organizations/services/saas-mode.service';
import { TurnstileApi, TurnstileComponent, TurnstileLoader } from '../../../shared/components/turnstile/turnstile.component';
import { InstallationSettings } from '../../models/account-settings';
import { ForgotPassword } from '../../stores/auth.state';
import { ForgotPasswordComponent } from './forgot-password.component';

/** The settings service as a form sees it: loaded (`settings`), still loading or failed */
const saasMode = (settings: InstallationSettings | 'loading' | 'failed') => ({
  saas$: of(typeof settings === 'object' && settings.saas),
  state$: of(typeof settings === 'object' ? { status: 'loaded', settings } : { status: settings }),
  reload: jasmine.createSpy('reload'),
});

describe('ForgotPasswordComponent', () => {
  let turnstile: jasmine.SpyObj<TurnstileApi>;
  let onToken: (token: string) => void;
  let dispatch: jasmine.Spy;

  const create = async (settings: InstallationSettings | 'loading' | 'failed') => {
    turnstile = jasmine.createSpyObj<TurnstileApi>('turnstile', ['render', 'reset', 'remove']);
    turnstile.render.and.callFake((_element, options) => {
      onToken = options.callback;
      return 'widget';
    });
    TestBed.configureTestingModule({
      declarations: [ForgotPasswordComponent],
      imports: [ReactiveFormsModule, TurnstileComponent, NgxsModule.forRoot([])],
      providers: [
        provideRouter([]),
        { provide: SaasModeService, useValue: saasMode(settings) },
        { provide: TurnstileLoader, useValue: { load: () => Promise.resolve(turnstile) } },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    });
    dispatch = spyOn(TestBed.inject(Store), 'dispatch').and.returnValue(of(undefined));
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.forgotPasswordForm.setValue({ email: 'ada@example.com' });
    return fixture;
  };

  it('waits for the bot check when it is on, sends its token, and asks for a fresh one after', async () => {
    const fixture = await create({ saas: true, turnstileSiteKey: 'site-key' });
    expect(fixture.componentInstance.ready).toBe(false);
    onToken('the-token');
    fixture.componentInstance.onSubmit();
    expect(dispatch).toHaveBeenCalledWith(new ForgotPassword('ada@example.com', 'the-token'));
    expect(turnstile.reset).toHaveBeenCalled();
  });

  it('sends nothing before the settings say whether the check is on, and offers to load them again (bot review of #679)', async () => {
    const failed = await create('failed');
    failed.detectChanges();
    expect(failed.componentInstance.ready).toBe(false);
    failed.componentInstance.onSubmit();
    expect(dispatch).not.toHaveBeenCalledWith(jasmine.any(ForgotPassword));
    (failed.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.alert-danger button').click();
    expect(TestBed.inject(SaasModeService).reload).toHaveBeenCalled();
  });

  it('sends the email alone when the check is off', async () => {
    const fixture = await create({ saas: false });
    expect(fixture.nativeElement.querySelector('app-turnstile')).toBeNull();
    fixture.componentInstance.onSubmit();
    expect(dispatch).toHaveBeenCalledWith(new ForgotPassword('ada@example.com', undefined));
  });
});
