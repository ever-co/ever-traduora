import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { TurnstileComponent } from '../../../shared/components/turnstile/turnstile.component';
import { acceptedVersions, InstallationSettings } from '../../models/account-settings';
import { Provider } from '../../models/provider';
import { SaasModeService } from '../../../organizations/services/saas-mode.service';
import { ClearMessages, GetProviders, Signup } from '../../stores/auth.state';

@Component({
  standalone: false,
  selector: 'app-signup',
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.css'],
})
export class SignupComponent implements OnInit, OnDestroy {
  passwordMinLength = 8;

  inviteOnly = environment.inviteOnly;

  // From the invitation link: proves that the person signing up received the invitation
  inviteToken = this.route.snapshot.queryParamMap.get('invite') || undefined;

  // An organization invitation's link says so: signing in to accept it goes to the organization's acceptance
  inviteKind = this.route.snapshot.queryParamMap.get('kind') === 'organization' ? 'organization' : undefined;

  // SaaS mode: a new person gets their own organization, named here (an invitation joins theirs instead)
  readonly saas$ = this.saasMode.saas$;

  /** The terms to accept (SaaS mode) and the Turnstile site key, once known */
  settings: InstallationSettings | undefined;

  /** The token of the Turnstile check, when it is on and passed */
  turnstileToken: string | undefined;

  @ViewChild(TurnstileComponent) private turnstile?: TurnstileComponent;

  signupForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(this.passwordMinLength)]],
    organizationName: ['', [Validators.maxLength(80)]],
    acceptTerms: [false],
  });

  @Select(state => state.auth.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(state => state.auth.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.auth.providers)
  providers$: Observable<Provider[]>;

  private settingsChanges: Subscription | undefined;

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private store: Store,
    private saasMode: SaasModeService,
  ) {}

  ngOnInit() {
    this.store.dispatch(new GetProviders());
    this.settingsChanges = this.saasMode.settings$.subscribe(settings => {
      this.settings = settings;
      // The terms are part of the form only when there are terms to accept
      const acceptTerms = this.signupForm.controls.acceptTerms;
      acceptTerms.setValidators(settings.legal ? Validators.requiredTrue : null);
      acceptTerms.updateValueAndValidity();
    });
  }

  ngOnDestroy() {
    this.settingsChanges?.unsubscribe();
    this.store.dispatch(new ClearMessages());
  }

  /** Whether the form may be sent: valid, and past the bot check when it is on */
  get ready(): boolean {
    return this.signupForm.valid && (!this.settings?.turnstileSiteKey || !!this.turnstileToken);
  }

  onSubmit() {
    if (!this.ready) {
      return;
    }
    const organizationName = ((this.signupForm.get('organizationName').value as string) || '').trim();
    const { termsVersion, privacyVersion } = acceptedVersions(this.settings?.legal);
    this.store
      .dispatch(
        new Signup(
          this.name.value as string,
          this.email.value as string,
          this.password.value as string,
          this.inviteToken,
          !this.inviteToken && organizationName.length >= 2 ? organizationName : undefined,
          termsVersion,
          privacyVersion,
          this.turnstileToken,
        ),
      )
      // A Turnstile token is good for one request: a refused sign-up needs a fresh check
      .subscribe({ error: () => this.turnstile?.reset() });
  }

  /** What the organization is called when the field stays empty (as the API names it) */
  get organizationPlaceholder(): string {
    const name = ((this.name.value as string) || '').trim();
    return name ? `${name}'s organization` : 'Your organization';
  }

  get name() {
    return this.signupForm.get('name');
  }

  get email() {
    return this.signupForm.get('email');
  }

  get password() {
    return this.signupForm.get('password');
  }

  get acceptTerms() {
    return this.signupForm.get('acceptTerms');
  }
}
