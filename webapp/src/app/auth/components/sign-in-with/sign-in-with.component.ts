import { Component, OnInit, Input } from '@angular/core';
import { Provider } from '../../models/provider';
import { RedirectToAuthProvider } from '../../stores/auth.state';
import { Store } from '@ngxs/store';

@Component({
  selector: 'app-sign-in-with',
  templateUrl: './sign-in-with.component.html',
  styleUrls: ['./sign-in-with.component.css'],
})
export class SignInWithComponent implements OnInit {
  @Input()
  provider: Provider;

  constructor(private store: Store) {}

  ngOnInit() {}

  signInWithProvider(provider: Provider) {
    this.store.dispatch(new RedirectToAuthProvider(provider));
  }

  providerToButton(provider: Provider): string {
    switch (provider.slug) {
      case 'google':
        return 'assets/img/signin-google/btn_google_signin_light_normal_web@2x.png';
      default:
        return 'Unknown auth provider';
    }
  }
}
