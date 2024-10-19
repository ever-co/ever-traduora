import { Component, OnDestroy, OnInit } from '@angular/core';
import { UntypedFormBuilder, Validators } from '@angular/forms';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { ClearMessages, ForgotPassword } from '../../stores/auth.state';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.component.html',
  styleUrls: ['./forgot-password.component.css'],
})
export class ForgotPasswordComponent implements OnInit, OnDestroy {
  forgotPasswordForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  constructor(
    private fb: UntypedFormBuilder,
    private store: Store,
  ) {}

  @Select(state => state.auth.statusMessage)
  statusMessage$: Observable<string | undefined>;

  @Select(state => state.auth.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(state => state.auth.isLoading)
  isLoading$: Observable<boolean>;

  message: string | undefined;

  ngOnInit() {}

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
  }

  onSubmit() {
    if (!this.forgotPasswordForm.valid) {
      return;
    }

    this.store.dispatch(new ForgotPassword(this.email.value as string));
  }

  get email() {
    return this.forgotPasswordForm.get('email');
  }
}
