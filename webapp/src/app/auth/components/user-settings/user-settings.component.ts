import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Select, Store } from '@ngxs/store';
import { Observable, Subscription } from 'rxjs';
import { tap } from 'rxjs/operators';
import { User } from '../../models/user';
import { AuthState, ChangePassword, ClearMessages, DeleteAccount, UpdateUserSelf } from '../../stores/auth.state';

@Component({
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

  private sub: Subscription;

  constructor(private fb: FormBuilder, private store: Store) {}

  ngOnInit() {
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
    this.sub.unsubscribe();
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
