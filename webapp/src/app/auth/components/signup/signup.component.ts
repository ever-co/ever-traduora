import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Provider } from '../../models/provider';
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

  constructor(
    private fb: FormBuilder,
    private route: ActivatedRoute,
    private store: Store,
  ) {}

  ngOnInit() {
    this.store.dispatch(new GetProviders());
  }

  ngOnDestroy() {
    this.store.dispatch(new ClearMessages());
  }

  onSubmit() {
    if (!this.signupForm.valid) {
      return;
    }
    this.store.dispatch(new Signup(this.name.value as string, this.email.value as string, this.password.value as string, this.inviteToken));
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
}
