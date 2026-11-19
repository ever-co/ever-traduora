import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngxs/store';
import { AuthService } from '../../services/auth.service';
import { GetUserInfo } from '../../stores/auth.state';

@Component({
  standalone: false,
  selector: 'app-verify-email',
  templateUrl: './verify-email.component.html',
})
export class VerifyEmailComponent implements OnInit {
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
    this.authService.verifyEmail(token).subscribe({
      next: () => {
        this.status = 'verified';
        this.store.dispatch(new GetUserInfo());
      },
      error: () => (this.status = 'failed'),
    });
  }
}
