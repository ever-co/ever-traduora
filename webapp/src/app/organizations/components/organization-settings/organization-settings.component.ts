import { NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { filter, finalize } from 'rxjs/operators';
import { canManage, isAllowedSlug, Organization, OrganizationMember } from '../../models/organization';
import { organizationErrorMessage } from '../../models/organization-errors';
import { OrganizationsService } from '../../services/organizations.service';
import { GetOrganizations, OrganizationsState, UpdateOrganization } from '../../stores/organizations.state';

/** /orgs/:slug/settings: the name and the address (owner, admin), and the transfer of ownership (owner). */
@Component({
  selector: 'app-organization-settings',
  imports: [NgIf, NgFor, ReactiveFormsModule],
  templateUrl: './organization-settings.component.html',
  styleUrls: ['./organization-settings.component.css'],
})
export class OrganizationSettingsComponent implements OnInit {
  organization: Organization | undefined;
  /** The members who can become the owner (everyone but the owner). */
  candidates: OrganizationMember[] = [];
  errorMessage: string | undefined;
  saved = false;
  busy = false;
  confirmTransfer = false;

  readonly form = this.fb.group({
    name: ['', Validators.compose([Validators.required, Validators.minLength(2), Validators.maxLength(80), Validators.pattern('.*[^ ].*')])],
    slug: ['', Validators.compose([Validators.required, control => (isAllowedSlug(control.value || '') ? null : { slug: true })])],
  });

  readonly transferForm = this.fb.group({ userId: ['', Validators.required] });

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

  /** The owner transfers the ownership, except of the default organization, whose members are not listed. */
  get isOwner(): boolean {
    return this.organization?.role === 'owner' && !this.organization.isDefault;
  }

  get newOwnerName(): string {
    const id = this.transferForm.getRawValue().userId;
    return this.candidates.find(member => member.userId === id)?.name ?? '';
  }

  ngOnInit(): void {
    this.store
      .select(OrganizationsState.currentOrganization)
      .pipe(
        filter((organization): organization is Organization => !!organization),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(organization => {
        const first = this.organization?.id !== organization.id;
        this.organization = organization;
        if (first) {
          // Another organization (the page is reused for it): nothing of the previous one carries over
          this.form.reset({ name: organization.name, slug: organization.slug });
          this.transferForm.reset({ userId: '' });
          this.confirmTransfer = false;
          this.saved = false;
          this.errorMessage = undefined;
          this.loadCandidates();
        }
      });
  }

  save(): void {
    if (!this.form.valid || !this.organization || this.busy) {
      return;
    }
    const { name, slug } = this.form.getRawValue();
    const slugChanged = slug !== this.organization.slug;
    this.busy = true;
    this.errorMessage = undefined;
    this.saved = false;
    this.store
      .dispatch(new UpdateOrganization(this.organization.id, { name: (name as string).trim(), slug: slug as string }))
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => {
          // Only what was sent counts as saved: an edit typed during the request stays to be saved
          const current = this.form.getRawValue();
          if (current.name === name && current.slug === slug) {
            this.saved = true;
            this.form.markAsPristine();
          }
          if (slugChanged) {
            // The address of this page changed with the slug
            this.router.navigate(['/orgs', slug, 'settings'], { replaceUrl: true });
          }
        },
        error: () => (this.errorMessage = this.store.selectSnapshot(OrganizationsState.errorMessage)),
      });
  }

  transfer(): void {
    const userId = this.transferForm.getRawValue().userId;
    if (!this.organization || !userId || this.busy) {
      return;
    }
    this.busy = true;
    this.errorMessage = undefined;
    this.organizations
      .transferOwnership(this.organization.id, userId)
      .pipe(finalize(() => (this.busy = false)))
      .subscribe({
        next: () => {
          this.confirmTransfer = false;
          this.transferForm.reset({ userId: '' });
          // The person is an admin now: the list says so
          this.store.dispatch(new GetOrganizations());
        },
        error: error => (this.errorMessage = organizationErrorMessage(error)),
      });
  }

  private loadCandidates(): void {
    this.candidates = [];
    if (!this.isOwner) {
      return;
    }
    // An answer for an organization the page no longer shows is dropped
    const organizationId = this.organization.id;
    this.organizations.members(organizationId).subscribe({
      next: members => {
        if (this.organization?.id === organizationId) {
          this.candidates = members.filter(member => member.role !== 'owner');
        }
      },
      error: error => {
        if (this.organization?.id === organizationId) {
          this.errorMessage = organizationErrorMessage(error);
        }
      },
    });
  }
}
