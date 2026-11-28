import { NgClass, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { SharedModule } from '../../../shared/shared.module';
import { errorToMessage } from '../../../shared/util/api-error';
import { PENDING_STEP_PAGES } from '../../models/account-settings';
import { localReturnPath } from '../../models/identity';
import { AuthService } from '../../services/auth.service';
import { GetUserInfo, Logout } from '../../stores/auth.state';

/**
 * /check-inbox: SaaS mode asks a new account to confirm its e-mail before anything else (403 `email_not_verified`).
 * The address the link went to, a new link, a fix for a mistyped address, and the way on once it is confirmed.
 */
@Component({
  selector: 'app-check-inbox',
  imports: [NgIf, NgClass, ReactiveFormsModule, SharedModule],
  templateUrl: './check-inbox.component.html',
  styleUrls: ['./check-inbox.component.css'],
})
export class CheckInboxComponent implements OnInit {
  /** Where the person was going, kept for after the confirmation */
  readonly returnTo = localReturnPath(this.route.snapshot.queryParamMap.get('returnTo')) ?? '/';

  email: string | undefined;
  busy = false;
  changing = false;
  message: { kind: 'info' | 'error'; text: string } | undefined;

  readonly emailForm = this.fb.group({ email: ['', [Validators.required, Validators.email]] });

  constructor(
    private readonly authService: AuthService,
    private readonly store: Store,
    private readonly router: Router,
    private readonly route: ActivatedRoute,
    private readonly fb: FormBuilder,
  ) {}

  ngOnInit(): void {
    // Already confirmed (another tab, an old link): straight on
    this.check(false);
  }

  resend(): void {
    this.run(this.authService.resendVerificationEmail(), () => {
      this.message = { kind: 'info', text: `We sent a new link to ${this.email}. It replaces the one before.` };
    });
  }

  /** After the person opened the link, maybe in another tab */
  confirmed(): void {
    this.check(true);
  }

  startChange(): void {
    this.changing = true;
    this.message = undefined;
    this.emailForm.reset({ email: '' });
  }

  saveEmail(): void {
    if (this.emailForm.invalid) {
      return;
    }
    this.run(this.authService.updateUserSelf({ email: this.emailForm.controls.email.value as string }), user => {
      this.email = user.email;
      this.changing = false;
      this.store.dispatch(new GetUserInfo());
      this.message = { kind: 'info', text: `We sent a link to ${user.email}. The one sent to the old address no longer works.` };
    });
  }

  signOut(): void {
    this.store.dispatch(new Logout());
  }

  /** Reads the account again: onwards once its e-mail is confirmed; `tell` says so when it is not yet */
  private check(tell: boolean): void {
    this.run(this.authService.getUserSelf(), user => {
      this.email = user.email;
      if (user.pending === 'email_not_verified') {
        if (tell) {
          this.message = { kind: 'info', text: 'Not confirmed yet. Open the link in the email we sent, then try again.' };
        }
        return;
      }
      this.store.dispatch(new GetUserInfo());
      if (user.pending === 'terms_not_accepted') {
        void this.router.navigate([PENDING_STEP_PAGES.terms_not_accepted], { queryParams: { returnTo: this.returnTo } });
      } else {
        void this.router.navigateByUrl(this.returnTo);
      }
    });
  }

  private run<T>(request: Observable<T>, done: (value: T) => void): void {
    this.busy = true;
    request.pipe(finalize(() => (this.busy = false))).subscribe({
      next: done,
      error: error => (this.message = { kind: 'error', text: errorToMessage(error, 'CheckInbox') }),
    });
  }
}
