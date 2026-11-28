import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Select, Store } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { SaasModeService, SettingsState } from '../../../organizations/services/saas-mode.service';
import { TurnstileComponent } from '../../../shared/components/turnstile/turnstile.component';
import { ClearMessages, ForgotPassword } from '../../stores/auth.state';

@Component({
  standalone: false,
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css'],
})
export class ForgotPasswordComponent implements OnInit, OnDestroy {
  forgotPasswordForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  /** The Turnstile site key, when the bot check is on */
  turnstileSiteKey: string | undefined;
  /** Whether the settings (the bot check) are loaded: the form waits for them, and offers "Try again" when they fail */
  settingsStatus: SettingsState['status'] = 'loading';
  turnstileToken: string | undefined;

  @ViewChild(TurnstileComponent) private turnstile?: TurnstileComponent;

  private settingsChanges: Subscription | undefined;

  constructor(
    private fb: FormBuilder,
    private store: Store,
    private saasMode: SaasModeService,
  ) {}

  @Select(state => state.auth.statusMessage)
  statusMessage$: Observable<string | undefined>;

  @Select(state => state.auth.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(state => state.auth.isLoading)
  isLoading$: Observable<boolean>;

  message: string | undefined;

  ngOnInit() {
    this.settingsChanges = this.saasMode.state$.subscribe(state => {
      this.settingsStatus = state.status;
      if (state.status === 'loaded') {
        this.turnstileSiteKey = state.settings.turnstileSiteKey;
      }
    });
  }

  ngOnDestroy() {
    this.settingsChanges?.unsubscribe();
    this.store.dispatch(new ClearMessages());
  }

  /** Whether the form may be sent: the settings loaded, a valid email, and past the bot check when it is on */
  get ready(): boolean {
    return this.settingsStatus === 'loaded' && this.forgotPasswordForm.valid && (!this.turnstileSiteKey || !!this.turnstileToken);
  }

  retrySettings(): void {
    this.saasMode.reload();
  }

  onSubmit() {
    if (!this.ready) {
      return;
    }
    this.store.dispatch(new ForgotPassword(this.email.value as string, this.turnstileToken)).subscribe({
      // A Turnstile token is good for one request, sent or refused: another request needs a fresh check
      next: () => this.turnstile?.reset(),
      error: () => this.turnstile?.reset(),
    });
  }

  get email() {
    return this.forgotPasswordForm.get('email');
  }
}
