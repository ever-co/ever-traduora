import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngxs/store';
import { Subscription } from 'rxjs';
import { Provider } from '../../../auth/models/provider';
import { AuthState, GetProviders, RedirectToAuthProvider } from '../../../auth/stores/auth.state';
import { ProvisionIntent, ProvisionResult, ProvisionService } from '../../services/provision.service';

/** This page, where a sign-in with Ever ID returns to. */
export const PROVISION_PATH = '/ever-connect/provision';

/** What an error code of the provisioning routes means to the person. */
const ERRORS: Record<string, string> = {
  invalid_intent: 'This link is not valid. Start again from app.ever.co.',
  wrong_audience: 'This link is not for Traduora. Start again from app.ever.co.',
  product_mismatch: 'This link is for another Ever product. Start again from app.ever.co.',
  instance_mismatch: 'This link is for another Traduora installation. Start again from app.ever.co.',
  intent_expired: 'This link has expired. Start again from app.ever.co.',
  intent_consumed: 'This link was already used.',
  invalid_txn: 'This confirmation is no longer valid. Open the link from app.ever.co again.',
  not_connected: 'This Traduora installation is not connected to Ever Platform.',
  intent_subject_mismatch:
    'You are signed in with another account. Sign in with the Ever ID you used on app.ever.co, or connect it to this account in Account settings, then try again.',
  project_limit: 'Your account cannot create more projects.',
  platform_unavailable: 'Ever Platform could not be reached. Nothing was created; try again in a moment.',
};

/** Codes after which this link cannot be used any more. */
const FINAL = ['invalid_intent', 'wrong_audience', 'product_mismatch', 'instance_mismatch', 'intent_expired', 'intent_consumed', 'invalid_txn'];

const NOT_AVAILABLE = 'Creating a project from app.ever.co is not available on this Traduora installation.';
const GENERIC_ERROR = 'That did not work. Please try again.';

type Step = 'loading' | 'missing' | 'confirm' | 'created' | 'exists' | 'refused' | 'failed';

/**
 * The hand-off landing page (`/ever-connect/provision#intent=…`): app.ever.co sends a person here with a signed intent
 * to create their organization's project in Traduora. The intent is read from the address fragment only (never a query
 * string), removed from the address bar at once and kept for this tab while the person signs in with Ever ID. Nothing
 * is created until the person, signed in with the same Ever ID, presses Create; Decline tells app.ever.co.
 */
@Component({
  standalone: false,
  selector: 'app-ever-connect-provision',
  templateUrl: './provision.component.html',
})
export class ProvisionComponent implements OnInit, OnDestroy {
  step: Step = 'loading';
  intent: ProvisionIntent | null = null;
  result: ProvisionResult | null = null;
  errorMessage: string | null = null;
  /** The confirmation was refused: this account does not hold the intent's Ever ID. */
  wrongAccount = false;
  signedIn = false;
  busy = false;
  everId: Provider | undefined;
  private readonly subscriptions = new Subscription();

  constructor(
    private readonly route: ActivatedRoute,
    private readonly store: Store,
    private readonly provision: ProvisionService,
  ) {}

  ngOnInit(): void {
    const fromLink = new URLSearchParams(this.route.snapshot.fragment || '').get('intent');
    if (fromLink) {
      this.provision.keep(fromLink);
      // The intent never stays in the address bar or in the history
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    }
    this.subscriptions.add(this.store.select(AuthState.isAuthenticated).subscribe(signedIn => (this.signedIn = !!signedIn)));
    this.subscriptions.add(
      this.store
        .select(state => state.auth && state.auth.providers)
        .subscribe((providers: Provider[] | undefined) => (this.everId = (providers || []).find(provider => provider.slug === 'everid'))),
    );
    this.store.dispatch(new GetProviders());

    const intent = fromLink || this.provision.kept();
    if (!intent) {
      this.step = 'missing';
      return;
    }
    this.provision.intent(intent).subscribe({
      next: answer => {
        this.intent = answer;
        this.step = 'confirm';
      },
      error: error => this.fail(error),
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  /** Signs in with Ever ID and comes back to this page (the intent is kept for this tab meanwhile). */
  continueWithEverId(): void {
    if (this.everId) {
      this.store.dispatch(new RedirectToAuthProvider(this.everId, { intent: 'signin', returnTo: PROVISION_PATH }));
    }
  }

  create(): void {
    if (!this.intent || this.busy) return;
    this.start();
    this.provision.confirm(this.intent.provisionTxn).subscribe({
      next: result => this.finish(result),
      error: error => this.fail(error),
    });
  }

  decline(): void {
    if (!this.intent || this.busy) return;
    this.start();
    this.provision.reject(this.intent.jti, this.intent.provisionTxn).subscribe({
      next: result => this.finish(result),
      error: error => this.fail(error),
    });
  }

  private start(): void {
    this.busy = true;
    this.errorMessage = null;
    this.wrongAccount = false;
  }

  private finish(result: ProvisionResult): void {
    this.busy = false;
    this.result = result;
    this.step = result.status;
    this.provision.forget();
  }

  private fail(error: unknown): void {
    this.busy = false;
    const response = error instanceof HttpErrorResponse ? error : null;
    const code: string | undefined = response?.error?.error?.code;
    if (code && ERRORS[code]) {
      this.errorMessage = ERRORS[code];
    } else {
      this.errorMessage = response?.status === 404 ? NOT_AVAILABLE : GENERIC_ERROR;
    }
    this.wrongAccount = code === 'intent_subject_mismatch';
    // The link cannot be used any more, or provisioning does not answer here (404): it is not kept
    if ((code && FINAL.includes(code)) || response?.status === 404) {
      this.provision.forget();
      this.step = 'failed';
    } else if (this.step === 'loading') {
      // The check itself failed (Ever Platform unreachable, for instance): the kept link can be tried again later
      this.step = 'failed';
    }
  }
}
