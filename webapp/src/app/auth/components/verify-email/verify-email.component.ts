import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Select, Store } from '@ngxs/store';
import { Observable } from 'rxjs';
import { AuthService } from '../../services/auth.service';
import { AuthState, GetUserInfo } from '../../stores/auth.state';

@Component({
  standalone: false,
  selector: 'app-verify-email',
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent implements OnInit {
  @Select(AuthState.isAuthenticated)
  isAuthenticated$: Observable<boolean>;

  status: 'verifying' | 'verified' | 'failed' = 'verifying';

  constructor(
    private readonly activatedRoute: ActivatedRoute,
    private readonly authService: AuthService,
    private readonly store: Store,
  ) {}

  ngOnInit(): void {
    const token = this.activatedRoute.snapshot.queryParamMap.get('token');
    if (!token) {
      this.status = 'failed';
      return;
    }
    // The link may be opened signed out or in another browser, so it works without a session
    this.authService.verifyEmail(token).subscribe({
      next: () => {
        this.status = 'verified';
        if (this.store.selectSnapshot(AuthState.isAuthenticated)) {
          this.store.dispatch(new GetUserInfo());
        }
      },
      error: () => (this.status = 'failed'),
    });
  }
}
