import { DatePipe, DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Observable, of } from 'rxjs';
import { catchError, finalize, map, switchMap, tap } from 'rxjs/operators';
import { PLAN_NAMES, usageFigure, usageMeterValue } from '../../../organizations/models/organization';
import { organizationErrorMessage } from '../../../organizations/models/organization-errors';
import { OperatorOrganizationDetail, REASON_MAX, reasonValidator } from '../../models/operator';
import { OperatorService } from '../../services/operator.service';

type Loaded = { detail: OperatorOrganizationDetail } | { error: unknown };

/**
 * /operator/organizations/:id: one organization as the operators see it (plan, live usage, owner, counts, status), its
 * suspension or restore with a reason, and the latest operator actions on it.
 */
@Component({
  selector: 'app-operator-organization',
  imports: [NgIf, NgFor, NgClass, DatePipe, DecimalPipe, RouterLink, ReactiveFormsModule],
  templateUrl: './operator-organization.component.html',
  styleUrls: ['../../operator-common.css', './operator-organization.component.css'],
})
export class OperatorOrganizationComponent implements OnInit {
  readonly planNames = PLAN_NAMES;
  readonly usageFigure = usageFigure;
  readonly usageMeterValue = usageMeterValue;
  readonly reasonMax = REASON_MAX;

  organization: OperatorOrganizationDetail | undefined;
  notFound = false;
  loadError: string | undefined;
  errorMessage: string | undefined;
  busy = false;
  confirming = false;

  readonly reason = new FormControl('', { nonNullable: true, validators: [reasonValidator] });

  private organizationId: string | undefined;

  constructor(
    private readonly operator: OperatorService,
    private readonly route: ActivatedRoute,
    private readonly destroyRef: DestroyRef,
  ) {}

  /** What an operator can do to it now: suspend an active one, restore a suspended one; never the default organization. */
  get action(): 'suspend' | 'restore' | null {
    const organization = this.organization;
    if (!organization || organization.isDefault) {
      return null;
    }
    if (organization.status === 'active') {
      return 'suspend';
    }
    return organization.status === 'suspended' ? 'restore' : null;
  }

  get reasonLength(): number {
    return this.reason.value.trim().length;
  }

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        map(params => params.get('id') ?? ''),
        tap(id => {
          // Another organization: nothing of the previous one carries over
          this.organizationId = id;
          this.organization = undefined;
          this.notFound = false;
          this.loadError = undefined;
          this.errorMessage = undefined;
          this.confirming = false;
          this.reason.reset('');
        }),
        switchMap(id => this.fetch(id)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(result => this.show(result));
  }

  isFull(used: number, limit: number): boolean {
    return used >= limit;
  }

  reload(): void {
    if (this.organizationId) {
      this.loadError = undefined;
      this.fetch(this.organizationId).subscribe(result => this.show(result));
    }
  }

  /** The first step: the reason is checked, then the operator confirms. */
  ask(): void {
    this.reason.markAsTouched();
    if (this.reason.valid && this.action) {
      this.errorMessage = undefined;
      this.confirming = true;
    }
  }

  cancel(): void {
    this.confirming = false;
  }

  confirm(): void {
    const organization = this.organization;
    const action = this.action;
    if (!organization || !action || this.reason.invalid || this.busy) {
      return;
    }
    this.busy = true;
    this.errorMessage = undefined;
    const request =
      action === 'suspend' ? this.operator.suspend(organization.id, this.reason.value) : this.operator.restore(organization.id, this.reason.value);
    request.pipe(finalize(() => (this.busy = false))).subscribe({
      next: detail => {
        if (this.organizationId !== organization.id) {
          return;
        }
        this.organization = detail;
        this.confirming = false;
        this.reason.reset('');
      },
      error: error => {
        if (this.organizationId !== organization.id) {
          return;
        }
        this.confirming = false;
        this.errorMessage = organizationErrorMessage(error);
        if (error?.error?.error?.code === 'organization_status') {
          // Another operator changed it meanwhile: show what it is now, the reason stays typed
          this.fetch(organization.id).subscribe(result => this.show(result, true));
        }
      },
    });
  }

  trackById(_: number, row: { id: string }): string {
    return row.id;
  }

  private fetch(id: string): Observable<Loaded> {
    return this.operator.organization(id).pipe(
      map(detail => ({ detail })),
      catchError(error => of({ error })),
    );
  }

  private show(result: Loaded, keepMessage = false): void {
    if ('detail' in result) {
      if (result.detail.id === this.organizationId) {
        this.organization = result.detail;
      }
      return;
    }
    if (keepMessage) {
      return;
    }
    if (result.error instanceof HttpErrorResponse && result.error.status === 404) {
      this.notFound = true;
      return;
    }
    this.loadError = organizationErrorMessage(result.error);
  }
}
