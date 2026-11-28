import { NgFor, NgIf } from '@angular/common';
import { HttpErrorResponse, HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { Store } from '@ngxs/store';
import { saveAs } from 'file-saver';
import { of } from 'rxjs';
import { catchError, filter, finalize, map, switchMap } from 'rxjs/operators';
import { canManage, isAllowedSlug, Organization, OrganizationMember } from '../../models/organization';
import { organizationErrorMessage } from '../../models/organization-errors';
import { OrganizationsService } from '../../services/organizations.service';
import { GetOrganizations, OrganizationsState, UpdateOrganization } from '../../stores/organizations.state';

/** The name of a downloaded export, as the API names it: `acme-export-2026-11-28.zip` (the day in UTC). */
export function exportFileName(slug: string, now = new Date()): string {
  return `${slug}-export-${now.toISOString().slice(0, 10)}.zip`;
}

/** "640 KB", "1.2 MB": how much of the export arrived. */
export function sizeFigure(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * /orgs/:slug/settings: the name and the address (owner, admin), the export (owner, admin), the transfer of ownership
 * and the deletion of the organization (owner, never of the default organization).
 */
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

  exporting = false;
  /** How much of the export arrived, while it downloads. */
  exportedBytes = 0;
  exportError: string | undefined;

  /** The address the owner types to confirm the deletion. */
  readonly deleteSlug = new FormControl('', { nonNullable: true });
  deleting = false;
  deleteError: string | undefined;
  readonly sizeFigure = sizeFigure;

  /** Set once the page is gone: a deletion that ends after it navigates nowhere. */
  private destroyed = false;

  constructor(
    private readonly store: Store,
    private readonly organizations: OrganizationsService,
    private readonly fb: FormBuilder,
    private readonly router: Router,
    private readonly destroyRef: DestroyRef,
  ) {
    destroyRef.onDestroy(() => (this.destroyed = true));
  }

  get canManage(): boolean {
    return canManage(this.organization?.role);
  }

  /** The owner transfers the ownership, except of the default organization, whose members are not listed. */
  get isOwner(): boolean {
    return this.organization?.role === 'owner' && !this.organization.isDefault;
  }

  /** The owner and the admins export the organization; the default organization has no export. */
  get canExport(): boolean {
    return this.canManage && !this.organization?.isDefault;
  }

  /** Whether the typed address is the organization's: the deletion waits for it. */
  get slugConfirmed(): boolean {
    return !!this.organization && this.deleteSlug.value.trim() === this.organization.slug;
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
          this.exportError = undefined;
          this.deleteSlug.reset('');
          this.deleteError = undefined;
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

  /** Downloads the organization's export as `<slug>-export-<day>.zip`, showing how much arrived meanwhile. */
  downloadExport(): void {
    const organization = this.organization;
    if (!organization || !this.canExport || this.exporting) {
      return;
    }
    this.exporting = true;
    this.exportedBytes = 0;
    this.exportError = undefined;
    this.organizations
      .exportArchive(organization.id)
      .pipe(finalize(() => (this.exporting = false)))
      .subscribe({
        next: event => {
          if (event.type === HttpEventType.DownloadProgress) {
            this.exportedBytes = event.loaded;
          } else if (event.type === HttpEventType.Response && event.body) {
            this.saveFile(event.body, exportFileName(organization.slug));
          }
        },
        error: error =>
          (this.exportError =
            error instanceof HttpErrorResponse && error.status === 0
              ? 'The download broke off before the end. Try again.'
              : organizationErrorMessage(error)),
      });
  }

  /** Hands the file to the browser (replaced in tests). */
  saveFile(blob: Blob, name: string): void {
    saveAs(blob, name);
  }

  /**
   * Deletes the organization once the owner typed its address, then reads the list again and opens another
   * organization, or the page to create one. The list is always read again; the page moves on only while it is still
   * open on the deleted organization (the owner may have gone elsewhere meanwhile).
   */
  deleteOrganization(): void {
    const organization = this.organization;
    if (!organization || !this.isOwner || !this.slugConfirmed || this.deleting) {
      return;
    }
    this.deleting = true;
    this.deleteError = undefined;
    this.organizations
      .remove(organization.id, this.deleteSlug.value.trim())
      .pipe(
        // Decided when the deletion answers: the refresh below makes the page show another organization anyway
        map(() => !this.destroyed && this.organization?.id === organization.id),
        // Deleted: the list is read again; if that fails, the deleted organization is left out below anyway
        switchMap(stillHere =>
          this.store.dispatch(new GetOrganizations()).pipe(
            catchError(() => of(undefined)),
            map(() => stillHere),
          ),
        ),
        finalize(() => (this.deleting = false)),
      )
      .subscribe({
        next: stillHere => {
          if (!stillHere || this.destroyed) {
            return;
          }
          const next = this.store
            .selectSnapshot(OrganizationsState.organizations)
            .find(other => other.id !== organization.id && other.status !== 'deleted');
          this.router.navigate(next ? ['/orgs', next.slug, 'projects'] : ['/orgs', 'new'], { replaceUrl: true });
        },
        error: error => (this.deleteError = organizationErrorMessage(error)),
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
