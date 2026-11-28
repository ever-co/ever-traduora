import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Store } from '@ngxs/store';
import { BehaviorSubject, combineLatest, EMPTY, forkJoin, Observable, of } from 'rxjs';
import { catchError, distinctUntilChanged, filter, finalize, switchMap } from 'rxjs/operators';
import { AuthState } from '../../../auth/stores/auth.state';
import {
  canManage,
  countOf,
  Organization,
  OrganizationInvite,
  OrganizationMember,
  OrganizationRole,
  OrganizationUsage,
  usageFigure,
  usageMeterValue,
} from '../../models/organization';
import { organizationErrorMessage } from '../../models/organization-errors';
import { OrganizationsService } from '../../services/organizations.service';
import { GetOrganizations, OrganizationsState } from '../../stores/organizations.state';

/**
 * /orgs/:slug/members: the members and pending invites, and inviting more (owner, admin), with the plan's seats and
 * strings above them for the owner and the admins.
 */
@Component({
  selector: 'app-organization-members',
  imports: [NgIf, NgFor, AsyncPipe, ReactiveFormsModule, RouterLink],
  templateUrl: './organization-members.component.html',
  styleUrls: ['./organization-members.component.css'],
})
export class OrganizationMembersComponent implements OnInit {
  organization: Organization | undefined;
  members: OrganizationMember[] | undefined;
  invites: OrganizationInvite[] = [];
  /** The plan and what the organization uses of it (owner, admin) */
  usage: OrganizationUsage | undefined;
  /** The usage reads sent, so that only the latest one updates the card */
  private usageReads = 0;
  /** The link of the invite just sent, to hand over when the email does not arrive. */
  lastInvite: OrganizationInvite | undefined;
  errorMessage: string | undefined;
  /** The last change was refused by the plan's limits (402 plan_limit_reached): a notice, not an error */
  limitReached = false;
  /** The lists could not be loaded: a retry is offered. */
  loadFailed = false;
  busy = false;
  private readonly reload$ = new BehaviorSubject<void>(undefined);

  readonly roles: OrganizationRole[] = ['member', 'admin'];
  readonly user$ = this.store.select(AuthState.user);

  readonly form = this.fb.group({
    email: ['', Validators.compose([Validators.required, Validators.email])],
    role: ['member' as OrganizationRole, Validators.required],
  });

  constructor(
    private readonly store: Store,
    private readonly organizations: OrganizationsService,
    private readonly fb: FormBuilder,
    private readonly router: Router,
    private readonly destroyRef: DestroyRef,
  ) {}

  get canManage(): boolean {
    return canManage(this.organization?.role);
  }

  readonly usageFigure = usageFigure;
  readonly usageMeterValue = usageMeterValue;

  /** Whether a limit is reached: nothing more of it can be added */
  isFull(used: number, limit: number | null): boolean {
    return limit !== null && used >= limit;
  }

  get seatsLine(): string {
    const members = this.members?.length ?? 0;
    const pending = this.invites.length;
    const membersText = countOf(members, 'member', 'members');
    if (pending === 0) {
      return membersText;
    }
    return `${membersText} · ${countOf(pending, 'pending invite', 'pending invites')}`;
  }

  ngOnInit(): void {
    const organization$ = this.store.select(OrganizationsState.currentOrganization).pipe(
      filter((organization): organization is Organization => !!organization),
      distinctUntilChanged((a, b) => a.id === b.id && a.role === b.role),
    );
    combineLatest([organization$, this.reload$])
      .pipe(
        switchMap(([organization]) => {
          // Another organization (the page is reused for it) or a retry: nothing shown before stays actionable
          this.organization = organization;
          this.members = undefined;
          this.invites = [];
          this.usage = undefined;
          this.lastInvite = undefined;
          this.errorMessage = undefined;
          this.limitReached = false;
          this.loadFailed = false;
          // The default organization holds every account of the installation: its members are not listed (API: 404)
          if (organization.isDefault) {
            return of<[OrganizationMember[], OrganizationInvite[]]>([[], []]);
          }
          // The plan card loads on its own: a usage that cannot be read never hides the members and the invites
          this.refreshUsage();
          return forkJoin([
            this.organizations.members(organization.id),
            canManage(organization.role) ? this.organizations.invites(organization.id) : of([] as OrganizationInvite[]),
          ]).pipe(
            // A failed load stays on this organization only: the next one (or a retry) loads again
            catchError(error => {
              this.errorMessage = organizationErrorMessage(error);
              this.loadFailed = true;
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(([members, invites]) => {
        this.members = members;
        this.invites = invites;
      });
  }

  retry(): void {
    this.reload$.next();
  }

  /** Whether the signed-in person may change this member's role or remove them (never the owner, never themselves). */
  canEdit(member: OrganizationMember, selfId: string | undefined): boolean {
    return this.canManage && member.role !== 'owner' && member.userId !== selfId;
  }

  invite(): void {
    if (!this.form.valid || !this.organization || this.busy) {
      return;
    }
    const { email, role } = this.form.getRawValue();
    this.run(this.organizations.invite(this.organization.id, email as string, role as OrganizationRole), result => {
      this.form.reset({ email: '', role: 'member' });
      if ('userId' in result) {
        this.members = [...(this.members ?? []), result];
        this.lastInvite = undefined;
      } else {
        this.invites = [...this.invites.filter(invite => invite.email !== result.email), result];
        this.lastInvite = result;
      }
      this.refreshUsage();
    });
  }

  changeRole(member: OrganizationMember, role: string): void {
    if (!this.organization || role === member.role) {
      return;
    }
    this.run(this.organizations.updateMember(this.organization.id, member.userId, role as OrganizationRole), updated => {
      this.members = (this.members ?? []).map(m => (m.userId === updated.userId ? updated : m));
    });
  }

  remove(member: OrganizationMember): void {
    if (!this.organization) {
      return;
    }
    this.run(this.organizations.removeMember(this.organization.id, member.userId), () => {
      this.members = (this.members ?? []).filter(m => m.userId !== member.userId);
      this.refreshUsage();
    });
  }

  /** Leaving: the person's project memberships in the organization go with them. */
  leave(selfId: string): void {
    if (!this.organization) {
      return;
    }
    this.run(
      this.organizations.removeMember(this.organization.id, selfId),
      () => {
        this.store.dispatch(new GetOrganizations()).subscribe(() => this.router.navigate(['/projects']));
      },
      true,
    );
  }

  revoke(invite: OrganizationInvite): void {
    if (!this.organization) {
      return;
    }
    this.run(this.organizations.revokeInvite(this.organization.id, invite.id), () => {
      this.invites = this.invites.filter(i => i.id !== invite.id);
      if (this.lastInvite?.id === invite.id) {
        this.lastInvite = undefined;
      }
      this.refreshUsage();
    });
  }

  trackByUser(_: number, member: OrganizationMember): string {
    return member.userId;
  }

  trackById(_: number, invite: OrganizationInvite): string {
    return invite.id;
  }

  /**
   * Sends a change. Its answer updates the lists only while they still show the organization it was sent for (the page
   * may be reused for another one meanwhile), unless `always` (leaving: the person left that organization either way).
   */
  private run<T>(request: Observable<T>, done: (result: T) => void, always = false): void {
    const organizationId = this.organization?.id;
    const current = () => always || this.organization?.id === organizationId;
    this.busy = true;
    this.errorMessage = undefined;
    this.limitReached = false;
    request.pipe(finalize(() => (this.busy = false))).subscribe({
      next: result => {
        if (current()) {
          done(result);
        }
      },
      error: error => {
        if (current()) {
          this.errorMessage = organizationErrorMessage(error);
          this.limitReached = error?.error?.error?.code === 'plan_limit_reached';
          if (this.limitReached) {
            // The plan's figures as they are now, next to the notice
            this.refreshUsage();
          }
        }
      },
    });
  }

  /** Reads the usage again after a change of the seats, for the owner and the admins. */
  private refreshUsage(): void {
    // Every refresh makes the reads before it stale, even one that reads nothing (a member, the default organization):
    // only the latest read updates the card, so an earlier one that answers last never shows older figures
    const read = ++this.usageReads;
    const organization = this.organization;
    if (!organization || organization.isDefault || !canManage(organization.role)) {
      return;
    }
    this.organizations
      .usage(organization.id)
      .pipe(catchError(() => EMPTY))
      .subscribe(usage => {
        // And only while the organization is still the one shown, and the person may still read its usage
        if (read === this.usageReads && this.organization?.id === organization.id && canManage(this.organization.role)) {
          this.usage = usage;
        }
      });
  }
}
