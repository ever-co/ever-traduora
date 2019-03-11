import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { ClearMessages, ResetPassword } from '../../stores/auth.state';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.component.html',
  styleUrls: ['./reset-password.component.css'],
})
export class ResetPasswordComponent implements OnInit, OnDestroy {
  passwordMinLength = 8;

  resetPasswordForm = this.fb.group({
    email: [{ value: this.queryEmail, disabled: true }, [Validators.required, Validators.email]],
    newPassword: ['', [Validators.required, Validators.minLength(this.passwordMinLength)]],
  });

  @Select(state => state.auth.statusMessage)
  statusMessage$: Observable<string | undefined>;

  @Select(state => state.auth.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(state => state.auth.isLoading)
  isLoading$: Observable<boolean>;

  tokenIsInvalid = false;

  constructor(private fb: FormBuilder, private store: Store, private route: ActivatedRoute) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
  }

  get queryToken(): string {
    return this.route.snapshot.queryParams.resetToken;
  }

  get queryEmail(): string {
    return this.route.snapshot.queryParams.email;
  }

  onSubmit() {
    if (!this.resetPasswordForm.valid) {
      return;
    }
    if (!this.queryToken) {
      // tslint:disable-next-line:quotemark
      return alert("Can't reset password. Please make sure you open the link sent to your email.");
    }

    this.store.dispatch(new ResetPassword(this.email.value as string, this.newPassword.value as string, this.queryToken));

    this.newPassword.disable();
  }

  get email() {
    return this.resetPasswordForm.get('email');
  }

  get newPassword() {
    return this.resetPasswordForm.get('newPassword');
  }
}
