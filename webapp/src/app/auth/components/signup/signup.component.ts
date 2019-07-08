import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Provider } from '../../models/provider';
import { AuthError, ClearMessages, GetProviders, LoggedIn, RedirectWithGoogle, Signup } from '../../stores/auth.state';

@Component({
  selector: 'app-signup',
  templateUrl: './signup.component.html',
  styleUrls: ['./signup.component.css'],
})
export class SignupComponent implements OnInit, OnDestroy {
  passwordMinLength = 8;

  inviteOnly = environment.inviteOnly;

  signupForm = this.fb.group({
    name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(this.passwordMinLength)]],
  });

  @Select(state => state.auth.errorMessage)
  errorMessage$: Observable<string | undefined>;

  @Select(state => state.auth.isLoading)
  isLoading$: Observable<boolean>;

  @Select(state => state.auth.providers)
  providers$: Observable<Provider[]>;

  constructor(private fb: FormBuilder, private store: Store) {
    this.afterSignUnWithGoogle = this.afterSignUnWithGoogle.bind(this);
  }

  ngOnInit() {
    this.store.dispatch(new GetProviders());
    window.addEventListener('message', this.afterSignUnWithGoogle);
  }

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
    window.removeEventListener('message', this.afterSignUnWithGoogle);
  }

  onSubmit() {
    if (!this.signupForm.valid) {
      return;
    }
    this.store.dispatch(new Signup(this.name.value as string, this.email.value as string, this.password.value as string));
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

  signUpWithGoogle(provider: Provider) {
    this.store.dispatch(new RedirectWithGoogle('signup', provider));
  }

  afterSignUnWithGoogle(event) {
    if (event.data.type === 'signup') {
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
