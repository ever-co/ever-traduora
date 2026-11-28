import { DatePipe, DecimalPipe, NgClass, NgFor, NgIf, NgSwitch, NgSwitchCase } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Params, RouterLink } from '@angular/router';
import { Observable, of, Subject } from 'rxjs';
import { catchError, finalize, map, switchMap } from 'rxjs/operators';
import { PLAN_NAMES, usageFigure, usageMeterValue } from '../../../organizations/models/organization';
import { organizationErrorMessage } from '../../../organizations/models/organization-errors';
import {
  auditActionLabel,
  billingUnsettled,
  listQueryParams,
  listStateFromParams,
  OperatorOrganizationDetail,
  REASON_MAX,
  reasonValidator,
  slugReleased,
} from '../../models/operator';
import { OperatorService } from '../../services/operator.service';

/** What an operator can do to an organization, each with a reason and a confirmation. */
export type OperatorActionKind = 'retryBilling' | 'suspend' | 'restore' | 'release';

type Loaded = { detail: OperatorOrganizationDetail } | { error: unknown };

/** A load of one organization; `keepMessage` keeps the action's error in view when its load fails too. */
interface LoadRequest {
  id: string;
  keepMessage: boolean;
}

/** The answers that mean the organization changed meanwhile: the page reads it again. */
const STALE_CODES = new Set(['organization_status', 'slug_released', 'billing_cancellation_none']);

const ACTION_COPY: Record<OperatorActionKind, { title: string; ask: string; confirm: string; danger: boolean }> = {
  retryBilling: { title: 'Retry the billing cancellation', ask: 'Retry billing cancellation', confirm: 'Retry now', danger: false },
  suspend: { title: 'Suspend the organization', ask: 'Suspend', confirm: 'Suspend organization', danger: true },
  restore: { title: 'Restore the organization', ask: 'Restore', confirm: 'Restore organization', danger: false },
  release: { title: 'Release the address', ask: 'Release address', confirm: 'Release address', danger: true },
};

function reasonControl(): FormControl<string> {
  return new FormControl('', { nonNullable: true, validators: [reasonValidator] });
}

/**
 * /operator/organizations/:id: one organization as the operators see it (plan, live usage, owner, counts, status, the
 * cancellation of its subscription after a deletion), what an operator can do to it with a reason (suspend, restore,
 * release a deleted organization's address, retry a billing cancellation), and the latest operator actions on it.
 */
@Component({
  selector: 'app-operator-organization',
  imports: [NgIf, NgFor, NgClass, NgSwitch, NgSwitchCase, DatePipe, DecimalPipe, RouterLink, ReactiveFormsModule],
  templateUrl: './operator-organization.component.html',
  styleUrls: ['../../operator-common.css', './operator-organization.component.css'],
})
export class OperatorOrganizationComponent implements OnInit {
  readonly planNames = PLAN_NAMES;
  readonly usageFigure = usageFigure;
  readonly usageMeterValue = usageMeterValue;
  readonly reasonMax = REASON_MAX;
  readonly copy = ACTION_COPY;
  readonly auditActionLabel = auditActionLabel;
  readonly billingUnsettled = billingUnsettled;

  organization: OperatorOrganizationDetail | undefined;
  notFound = false;
  loadError: string | undefined;
  errorMessage: string | undefined;
  /** The action being sent. */
  busy: OperatorActionKind | null = null;
  /** The action waiting for its confirmation. */
  confirming: OperatorActionKind | null = null;
  /** The list's search, filters and page, carried back by "All organizations". */
  backParams: Params = {};

  readonly reasons: Record<OperatorActionKind, FormControl<string>> = {
    retryBilling: reasonControl(),
    suspend: reasonControl(),
    restore: reasonControl(),
    release: reasonControl(),
  };

  private organizationId: string | undefined;
  private readonly load$ = new Subject<LoadRequest>();

  constructor(
    private readonly operator: OperatorService,
    private readonly route: ActivatedRoute,
    private readonly destroyRef: DestroyRef,
  ) {}

  /**
   * What an operator can do to it now, the billing first: retry a pending or failed cancellation; suspend an active
   * organization or restore a suspended one, never the default one; release a deleted one's address once.
   */
  get actions(): OperatorActionKind[] {
    const organization = this.organization;
    if (!organization) {
      return [];
    }
    const actions: OperatorActionKind[] = [];
    if (billingUnsettled(organization.billingCancellation?.status)) {
      actions.push('retryBilling');
    }
    if (organization.status === 'active' && !organization.isDefault) {
      actions.push('suspend');
    } else if (organization.status === 'suspended' && !organization.isDefault) {
      actions.push('restore');
    } else if (organization.status === 'deleted' && !slugReleased(organization.slug)) {
      actions.push('release');
    }
    return actions;
  }

  get released(): boolean {
    return !!this.organization && this.organization.status === 'deleted' && slugReleased(this.organization.slug);
  }

  ngOnInit(): void {
    // One load at a time: a newer one (another organization, or "Try again") drops the answer to an older one
    this.load$
      .pipe(
        switchMap(request => this.fetch(request.id).pipe(map(result => ({ request, result })))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ request, result }) => this.show(request, result));

    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(params => (this.backParams = listQueryParams(listStateFromParams(params))));

    this.route.paramMap
      .pipe(
        map(params => params.get('id') ?? ''),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(id => {
        // Another organization: nothing of the previous one carries over
        this.organizationId = id;
        this.organization = undefined;
        this.notFound = false;
        this.loadError = undefined;
        this.errorMessage = undefined;
        this.confirming = null;
        this.resetReasons();
        this.load$.next({ id, keepMessage: false });
      });
  }

  isFull(used: number, limit: number): boolean {
    return used >= limit;
  }

  reasonLength(kind: OperatorActionKind): number {
    return this.reasons[kind].value.trim().length;
  }

  reload(): void {
    if (this.organizationId) {
      this.loadError = undefined;
      this.load$.next({ id: this.organizationId, keepMessage: false });
    }
  }

  /** The first step: the reason is checked, then the operator confirms. */
  ask(kind: OperatorActionKind): void {
    const reason = this.reasons[kind];
    reason.markAsTouched();
    if (reason.valid && this.actions.includes(kind)) {
      this.errorMessage = undefined;
      this.confirming = kind;
    }
  }

  cancel(): void {
    this.confirming = null;
  }

  /** The question the confirmation asks, with the organization's name or address. */
  question(kind: OperatorActionKind, organization: OperatorOrganizationDetail): string {
    switch (kind) {
      case 'retryBilling':
        return `Try to cancel the subscription of ${organization.name} again now?`;
      case 'suspend':
        return `Suspend ${organization.name} now? Its members are locked out at once`;
      case 'restore':
        return `Restore ${organization.name} now? Its members get their access back`;
      case 'release':
        return `Release /orgs/${organization.slug} now? Anyone can then take it`;
    }
  }

  confirm(kind: OperatorActionKind): void {
    const organization = this.organization;
    const reason = this.reasons[kind];
    if (!organization || this.busy || reason.invalid || !this.actions.includes(kind)) {
      return;
    }
    this.busy = kind;
    this.errorMessage = undefined;
    this.send(kind, organization.id, reason.value)
      .pipe(finalize(() => (this.busy = null)))
      .subscribe({
        next: detail => {
          if (this.organizationId !== organization.id) {
            return;
          }
          this.organization = detail;
          this.confirming = null;
          reason.reset('');
        },
        error: error => {
          if (this.organizationId !== organization.id) {
            return;
          }
          this.confirming = null;
          this.errorMessage = organizationErrorMessage(error);
          if (STALE_CODES.has(error?.error?.error?.code)) {
            // Another operator, or the retries, changed it meanwhile: show what it is now, the reason stays typed
            this.load$.next({ id: organization.id, keepMessage: true });
          }
        },
      });
  }

  trackById(_: number, row: { id: string }): string {
    return row.id;
  }

  private send(kind: OperatorActionKind, id: string, reason: string): Observable<OperatorOrganizationDetail> {
    switch (kind) {
      case 'retryBilling':
        return this.operator.retryBillingCancellation(id, reason);
      case 'suspend':
        return this.operator.suspend(id, reason);
      case 'restore':
        return this.operator.restore(id, reason);
      case 'release':
        return this.operator.releaseSlug(id, reason);
    }
  }

  private resetReasons(): void {
    for (const control of Object.values(this.reasons)) {
      control.reset('');
    }
  }

  private fetch(id: string): Observable<Loaded> {
    return this.operator.organization(id).pipe(
      map(detail => ({ detail })),
      catchError(error => of({ error })),
    );
  }

  private show(request: LoadRequest, result: Loaded): void {
    if (request.id !== this.organizationId) {
      // An answer for an organization the page no longer shows
      return;
    }
    if ('detail' in result) {
      this.notFound = false;
      this.loadError = undefined;
      this.organization = result.detail;
      return;
    }
    if (request.keepMessage) {
      return;
    }
    if (result.error instanceof HttpErrorResponse && result.error.status === 404) {
      this.notFound = true;
      return;
    }
    this.loadError = organizationErrorMessage(result.error);
  }
}
