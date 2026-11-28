import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService } from '../../services/auth.service';
import { OrganizationsService } from '../../../organizations/services/organizations.service';
import { Store } from '@ngxs/store';
import { GetOrganizations, SetCurrentOrganization } from '../../../organizations/stores/organizations.state';
import { isPlanLimit, planLimitMessage } from '../../../shared/util/api-error';

const INVITE_LINK_FAILED =
  'This invitation link does not work for your account. It only works for the email it was sent to, ' +
  'and only until it is used or the invitation is sent again.';

/** A refusal for want of a free seat says so, with the plan's limit; any other failure is about the link. */
function failureMessage(error: unknown): string {
  return isPlanLimit(error) ? planLimitMessage((error as { error?: { error?: unknown } }).error?.error, true) : INVITE_LINK_FAILED;
}

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
    private readonly organizations: OrganizationsService,
    private readonly store: Store,
  ) {}

  ngOnInit(): void {
    const inviteToken = this.activatedRoute.snapshot.queryParamMap.get('invite');
    if (!inviteToken) {
      this.router.navigate(['/']);
      return;
    }
    if (this.activatedRoute.snapshot.queryParamMap.get('kind') === 'organization') {
      this.organizations.acceptInvite(inviteToken).subscribe({
        next: ({ organizationId, slug }) => {
          this.store.dispatch([new GetOrganizations(), new SetCurrentOrganization(organizationId)]);
          this.router.navigate(['/orgs', slug, 'projects']);
        },
        error: error => (this.errorMessage = failureMessage(error)),
      });
      return;
    }
    this.authService.acceptInvite(inviteToken).subscribe({
      next: ({ projectId }) => this.router.navigate(['/projects', projectId]),
      error: error => (this.errorMessage = failureMessage(error)),
    });
  }
}
