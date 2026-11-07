import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { AuthService, providerOfState } from '../../services/auth.service';
import { ProviderSignInFailed, ReceiveAuthProviderCode, ReceiveIdentityConnectCode } from '../../stores/auth.state';

@Component({
  standalone: false,
  selector: 'app-callback',
  templateUrl: './callback.component.html',
  styleUrls: ['./callback.component.css'],
})
export class AuthCallbackComponent implements OnInit {
  constructor(
    private activatedRoute: ActivatedRoute,
    private store: Store,
    private router: Router,
    private authService: AuthService,
  ) {}
  ngOnInit(): void {
    this.activatedRoute.queryParams.subscribe(params => {
      // OpenID Connect providers (e.g. Ever ID) return the `state` of the request; Google callbacks carry none
      if (providerOfState(params.state)) {
        this.receiveOidcCallback(params);
        return;
      }
      if (!params.code) {
        this.router.navigate(['/']);
      }
      this.store.dispatch(new ReceiveAuthProviderCode(params.code));
    });
  }

  /**
   * Continues an OpenID Connect sign-in or connect: only for the request this browser started (same `state`), whose
   * nonce and PKCE verifier are read once from session storage.
   */
  private receiveOidcCallback(params: { [key: string]: string }) {
    const pending = this.authService.takePendingAuthorization(params.state);
    if (!pending) {
      this.store.dispatch(new ProviderSignInFailed('The sign-in could not be completed. Please try again.'));
      return;
    }
    if (pending.intent === 'connect') {
      if (!params.code) {
        this.router.navigate(['/user-settings']);
        return;
      }
      this.store.dispatch(
        new ReceiveIdentityConnectCode({
          code: params.code,
          provider: pending.provider,
          state: params.state,
          nonce: pending.nonce,
          code_verifier: pending.codeVerifier,
        }),
      );
      return;
    }
    if (!params.code) {
      // Cancelled or refused at the provider
      this.store.dispatch(new ProviderSignInFailed('The sign-in was cancelled.'));
      return;
    }
    this.store.dispatch(
      new ReceiveAuthProviderCode(params.code, {
        provider: pending.provider,
        state: params.state,
        nonce: pending.nonce,
        code_verifier: pending.codeVerifier,
      }),
    );
  }
}
