import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { AuthError, ClearMessages, LoggedIn, Login, RedirectWithGoogle, GetProviders } from '../../stores/auth.state';
import { Provider } from '../../models/provider';

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

  @Select(state => state.auth.providers)
  providers$: Observable<Provider[]>;

  constructor(private fb: FormBuilder, private store: Store) {
    this.afterSignInWithGoogle = this.afterSignInWithGoogle.bind(this);
  }

  ngOnInit() {
    this.store.dispatch(new GetProviders());
    window.addEventListener('message', this.afterSignInWithGoogle);
  }

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
    window.removeEventListener('message', this.afterSignInWithGoogle);
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

  signInWithGoogle(provider: Provider) {
    this.store.dispatch(new RedirectWithGoogle('login', provider));
  }

  afterSignInWithGoogle(event) {
    if (event.data.type === 'loggedIn') {
      const { payload, error } = event.data;
      if (payload) {
        this.store.dispatch(new LoggedIn(JSON.parse(event.data.payload)));
      }
      if (error) {
        this.store.dispatch(new AuthError('login', JSON.parse(error)));
      }
    }
  }
}
