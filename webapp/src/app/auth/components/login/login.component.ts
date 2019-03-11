import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { ClearMessages, Login } from '../../stores/auth.state';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrls: ['./login.component.css'],
})
export class LoginComponent implements OnInit, OnDestroy {
  loginForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
  });

  @Select(state => state.auth.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(state => state.auth.isLoading)
  isLoading$: Observable<boolean>;

  constructor(private fb: FormBuilder, private store: Store) {}

  ngOnInit() {}

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
  }

  onSubmit() {
    if (!this.loginForm.valid) {
      return;
    }
    this.store.dispatch(new Login(this.email.value as string, this.password.value as string));
  }

  get email() {
    return this.loginForm.get('email');
  }

  get password() {
    return this.loginForm.get('password');
  }
}
