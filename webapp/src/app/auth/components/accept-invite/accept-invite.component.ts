import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-accept-invite',
  templateUrl: './accept-invite.component.html',
})
export class AcceptInviteComponent implements OnInit {
  errorMessage: string | undefined;

  constructor(
    private readonly activatedRoute: ActivatedRoute,
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}

  ngOnInit(): void {
    const inviteToken = this.activatedRoute.snapshot.queryParamMap.get('invite');
    if (!inviteToken) {
      this.router.navigate(['/']);
      return;
    }
    this.authService.acceptInvite(inviteToken).subscribe({
      next: ({ projectId }) => this.router.navigate(['/projects', projectId]),
      error: () =>
        (this.errorMessage =
          'This invitation link does not work for your account. It only works for the email it was sent to, ' +
          'and only until it is used or the invitation is sent again.'),
    });
  }
}
