import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  standalone: false,
  selector: 'app-accept-invite',
  templateUrl: './accept-invite.component.html',
  styleUrls: ['./accept-invite.component.css'],
})
export class AcceptInviteComponent implements OnInit {
  errorMessage: string | undefined;

  constructor(
    private activatedRoute: ActivatedRoute,
    private authService: AuthService,
    private router: Router,
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
