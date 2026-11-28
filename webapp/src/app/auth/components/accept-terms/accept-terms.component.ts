import { NgIf } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { SaasModeService } from '../../../organizations/services/saas-mode.service';
import { SharedModule } from '../../../shared/shared.module';
import { errorToMessage } from '../../../shared/util/api-error';
import { acceptedVersions, LegalDocuments } from '../../models/account-settings';
import { localReturnPath } from '../../models/identity';
import { AuthService } from '../../services/auth.service';
import { GetUserInfo, Logout } from '../../stores/auth.state';

/**
 * /accept-terms: SaaS mode asks an account to accept the terms of service and privacy policy in force before anything
 * else (403 `terms_not_accepted`): an account made with Google or Ever ID, one from before the terms, or anyone after a
 * new version. Accepting records the versions and goes back where the person was going.
 */
@Component({
  selector: 'app-accept-terms',
  imports: [NgIf, ReactiveFormsModule, SharedModule],
  templateUrl: './accept-terms.component.html',
  styleUrls: ['./accept-terms.component.css'],
})
export class AcceptTermsComponent implements OnInit, OnDestroy {
  readonly returnTo = localReturnPath(this.route.snapshot.queryParamMap.get('returnTo')) ?? '/';

  legal: LegalDocuments | undefined;
  /** Whether the person accepted an older version before (the terms changed), or none yet */
  changed = false;
  busy = false;
  errorMessage: string | undefined;

  readonly form = this.fb.group({ accept: [false, Validators.requiredTrue] });

  private subscriptions: Subscription[] = [];

  constructor(
    private readonly authService: AuthService,
    private readonly saasMode: SaasModeService,
    private readonly store: Store,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly fb: FormBuilder,
  ) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.saasMode.settings$.subscribe(settings => (this.legal = settings.legal)),
      this.authService.getUserSelf().subscribe({
        next: user => {
          this.changed = !!user.termsVersion || !!user.privacyVersion;
          if (user.pending !== 'terms_not_accepted') {
            // Nothing to accept (accepted in another tab, or not SaaS mode)
            void this.router.navigateByUrl(this.returnTo);
          }
        },
        error: () => undefined,
      }),
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach(subscription => subscription.unsubscribe());
  }

  accept(): void {
    const { termsVersion, privacyVersion } = acceptedVersions(this.legal);
    if (this.form.invalid || !termsVersion || !privacyVersion) {
      return;
    }
    this.busy = true;
    this.errorMessage = undefined;
    this.authService
      .acceptTerms({ termsVersion, privacyVersion })
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => {
          this.store.dispatch(new GetUserInfo());
          void this.router.navigateByUrl(this.returnTo);
        },
        error: error =>
          (this.errorMessage =
            error?.status === 400
              ? 'The terms changed again in the meantime. Reload the page to read the current ones.'
              : errorToMessage(error, 'AcceptTerms')),
      });
  }

  signOut(): void {
    this.store.dispatch(new Logout());
  }
}
