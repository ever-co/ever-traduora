import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Select, Store } from '@ngxs/store';
import { combineLatest, Observable, Subscription } from 'rxjs';
import { map, tap } from 'rxjs/operators';
import { Identity, IdentityConnection } from '../../models/identity';
import { Provider } from '../../models/provider';
import { User } from '../../models/user';
import { AuthService } from '../../services/auth.service';
import {
  AuthState,
  CancelIdentityConnect,
  ChangePassword,
  ClearMessages,
  ConfirmIdentityConnect,
  DeleteAccount,
  DeleteIdentity,
  GetIdentities,
  GetProviders,
  RedirectToAuthProvider,
  UpdateUserSelf,
} from '../../stores/auth.state';

@Component({
  standalone: false,
  selector: 'app-user-settings',
  templateUrl: './user-settings.component.html',
  styleUrls: ['./user-settings.component.css'],
})
export class UserSettingsComponent implements OnInit, OnDestroy {
  userDataForm = this.fb.group({
    name: ['', [Validators.required]],
    email: ['', [Validators.required, Validators.email]],
  });

  userPasswordForm = this.fb.group({
    oldPassword: ['', [Validators.required, Validators.minLength(8)]],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
  });

  @Select(AuthState.user)
  user$: Observable<User | undefined>;

  @Select(state => state.auth.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(AuthState.statusMessage)
  statsMessage$: Observable<string | undefined>;

  @Select(state => state.auth.isLoading)
  isLoading$: Observable<boolean>;

  verificationEmail: 'unsent' | 'sending' | 'sent' | 'failed' = 'unsent';

  // Connected sign-in methods: shown only while Ever ID sign-in is on
  @Select(state => state.auth.providers)
  providers$: Observable<Provider[] | undefined>;

  @Select(AuthState.identities)
  identities$: Observable<Identity[] | undefined>;

  @Select(AuthState.pendingConnect)
  pendingConnect$: Observable<IdentityConnection | undefined>;

  everIdProvider$: Observable<Provider | undefined>;

  // "Connect Ever ID" shows while no identity is connected and no connection waits for confirmation
  canConnectEverId$: Observable<boolean>;

  private sub: Subscription;

  private providersSub: Subscription;

  constructor(
    private fb: FormBuilder,
    private store: Store,
    private authService: AuthService,
  ) {}

  resendVerificationEmail() {
    this.verificationEmail = 'sending';
    this.authService.resendVerificationEmail().subscribe({
      next: () => (this.verificationEmail = 'sent'),
      error: () => (this.verificationEmail = 'failed'),
    });
  }

  ngOnInit() {
    this.everIdProvider$ = this.providers$.pipe(map(providers => (providers || []).find(provider => provider.slug === 'everid')));
    this.providersSub = this.everIdProvider$.subscribe(provider => {
      if (provider) {
        this.store.dispatch(new GetIdentities());
      }
    });
    this.store.dispatch(new GetProviders());
    this.canConnectEverId$ = combineLatest([this.identities$, this.pendingConnect$]).pipe(
      map(([identities, pendingConnect]) => !identities?.length && !pendingConnect),
    );

    this.sub = this.user$
      .pipe(
        tap(user => {
          if (user) {
            this.name.setValue(user.name);
            this.email.setValue(user.email);
          }
        }),
      )
      .subscribe();
  }

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
    this.store.dispatch(new CancelIdentityConnect());
    this.sub.unsubscribe();
    this.providersSub?.unsubscribe();
  }

  /** Connecting needs a fresh sign-in at Ever ID; the callback then asks to confirm both emails. */
  connectEverId(provider: Provider) {
    this.store.dispatch(new RedirectToAuthProvider(provider, { intent: 'connect' }));
  }

  confirmConnect() {
    this.store.dispatch(new ConfirmIdentityConnect());
  }

  cancelConnect() {
    this.store.dispatch(new CancelIdentityConnect());
  }

  disconnect(identity: Identity) {
    if (confirm(`Disconnect the Ever ID ${identity.email} from your account? You will no longer be able to sign in with it.`)) {
      this.store.dispatch(new DeleteIdentity(identity.id));
    }
  }

  updateUserData() {
    if (!this.userDataForm.valid) {
      return;
    }
    const updates = {};
    if (this.name.dirty) {
      updates['name'] = this.name.value as string;
    }
    if (this.email.dirty) {
      updates['email'] = this.email.value as string;
    }
    this.store.dispatch(new UpdateUserSelf(updates));
  }

  async changePassword() {
    if (!this.userPasswordForm.valid) {
      return;
    }

    await this.store.dispatch(new ChangePassword(this.oldPassword.value as string, this.newPassword.value as string));
    this.userPasswordForm.reset();
  }

  get name() {
    return this.userDataForm.get('name');
  }

  get email() {
    return this.userDataForm.get('email');
  }

  get oldPassword() {
    return this.userPasswordForm.get('oldPassword');
  }

  get newPassword() {
    return this.userPasswordForm.get('newPassword');
  }

  async deleteAccount(user: User) {
    const ok = confirm(`You're about to permanently delete your account and all related data. Are you sure?`);
    if (ok) {
      const emailPrompt = prompt('To delete your account, please enter your full email address as confirmation:');
      if (user.email && emailPrompt === user.email) {
        console.warn('Account deletion requested');
        this.store.dispatch(new DeleteAccount());
      }
    }
  }
}
