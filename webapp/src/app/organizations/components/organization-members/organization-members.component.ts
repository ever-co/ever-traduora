import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { forkJoin, Observable, of } from 'rxjs';
import { distinctUntilChanged, filter, finalize, switchMap } from 'rxjs/operators';
import { AuthState } from '../../../auth/stores/auth.state';
import { canManage, Organization, OrganizationInvite, OrganizationMember, OrganizationRole } from '../../models/organization';
import { organizationErrorMessage } from '../../models/organization-errors';
import { OrganizationsService } from '../../services/organizations.service';
import { GetOrganizations, OrganizationsState } from '../../stores/organizations.state';

/** /orgs/:slug/members: the members and pending invites, the seats they take, and inviting more (owner, admin). */
@Component({
  selector: 'app-organization-members',
  imports: [NgIf, NgFor, AsyncPipe, ReactiveFormsModule],
  templateUrl: './organization-members.component.html',
  styleUrls: ['./organization-members.component.css'],
})
export class OrganizationMembersComponent implements OnInit {
  organization: Organization | undefined;
  members: OrganizationMember[] | undefined;
  invites: OrganizationInvite[] = [];
  /** The link of the invite just sent, to hand over when the email does not arrive. */
  lastInvite: OrganizationInvite | undefined;
  errorMessage: string | undefined;
  busy = false;

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

  get seatsLine(): string {
    const members = this.members?.length ?? 0;
    const pending = this.invites.length;
    const membersText = `${members} ${members === 1 ? 'member' : 'members'}`;
    return pending > 0 ? `${membersText} · ${pending} pending ${pending === 1 ? 'invite' : 'invites'}` : membersText;
  }

  ngOnInit(): void {
    this.store
      .select(OrganizationsState.currentOrganization)
      .pipe(
        filter((organization): organization is Organization => !!organization),
        distinctUntilChanged((a, b) => a.id === b.id && a.role === b.role),
        switchMap(organization => {
          this.organization = organization;
          // The default organization holds every account of the installation: its members are not listed (API: 404)
          if (organization.isDefault) {
            return of<[OrganizationMember[], OrganizationInvite[]]>([[], []]);
          }
          return forkJoin([
            this.organizations.members(organization.id),
            canManage(organization.role) ? this.organizations.invites(organization.id) : of([] as OrganizationInvite[]),
          ]);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: ([members, invites]) => {
          this.members = members;
          this.invites = invites;
        },
        error: error => (this.errorMessage = organizationErrorMessage(error)),
      });
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
    });
  }

  /** Leaving: the person's project memberships in the organization go with them. */
  leave(selfId: string): void {
    if (!this.organization) {
      return;
    }
    this.run(this.organizations.removeMember(this.organization.id, selfId), () => {
      this.store.dispatch(new GetOrganizations()).subscribe(() => this.router.navigate(['/projects']));
    });
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
    });
  }

  trackByUser(_: number, member: OrganizationMember): string {
    return member.userId;
  }

  trackById(_: number, invite: OrganizationInvite): string {
    return invite.id;
  }

  private run<T>(request: Observable<T>, done: (result: T) => void): void {
    this.busy = true;
    this.errorMessage = undefined;
    request.pipe(finalize(() => (this.busy = false))).subscribe({
      next: result => done(result),
      error: error => (this.errorMessage = organizationErrorMessage(error)),
    });
  }
}
