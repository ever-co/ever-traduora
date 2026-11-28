import { DatePipe, DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { NgbPagination } from '@ng-bootstrap/ng-bootstrap';
import { Observable, of, Subject } from 'rxjs';
import { catchError, debounceTime, map, switchMap } from 'rxjs/operators';
import { PLAN_NAMES } from '../../../organizations/models/organization';
import { organizationErrorMessage } from '../../../organizations/models/organization-errors';
import {
  billingUnsettled,
  listQueryParams,
  listStateFromParams,
  OPERATOR_PAGE_SIZE,
  OperatorBillingFilter,
  OperatorOrganization,
  OperatorOrganizationsQuery,
  OperatorPage,
  OperatorStatusFilter,
  STATUS_FILTERS,
} from '../../models/operator';
import { OperatorService } from '../../services/operator.service';

type Loaded = { page: OperatorPage<OperatorOrganization> } | { error: unknown };

const figures = new Intl.NumberFormat('en-US');

/**
 * /operator/organizations: every organization of the installation, newest first, searched by name, address, id or the
 * owner's email and filtered by status and by an unsettled billing cancellation. The search, the filters and the page
 * are kept in the address and carried to each organization, so the way back lands on the same page.
 */
@Component({
  selector: 'app-operator-organizations',
  imports: [NgIf, NgFor, NgClass, DatePipe, DecimalPipe, RouterLink, NgbPagination],
  templateUrl: './operator-organizations.component.html',
  styleUrls: ['../../operator-common.css'],
})
export class OperatorOrganizationsComponent implements OnInit {
  readonly statusFilters = STATUS_FILTERS;
  readonly planNames = PLAN_NAMES;
  readonly pageSize = OPERATOR_PAGE_SIZE;
  readonly billingUnsettled = billingUnsettled;

  q = '';
  status: OperatorStatusFilter = '';
  billing: OperatorBillingFilter = '';
  page = 1;
  /** `undefined` until an answer for the current query. */
  rows: OperatorOrganization[] | undefined;
  total = 0;
  loading = false;
  errorMessage: string | undefined;
  /** The list's state as query parameters, for its address and for the links to each organization. */
  queryParams: Params = {};

  private readonly typed$ = new Subject<string>();
  private readonly load$ = new Subject<OperatorOrganizationsQuery>();

  constructor(
    private readonly operator: OperatorService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly destroyRef: DestroyRef,
  ) {}

  get countLine(): string {
    if (this.rows === undefined) {
      return '';
    }
    const noun = this.total === 1 ? 'organization' : 'organizations';
    return `${figures.format(this.total)} ${noun}${this.filtered ? ' found' : ''}`;
  }

  get filtered(): boolean {
    return !!(this.q || this.status || this.billing);
  }

  get emptyLine(): string {
    if (this.billing && !this.q && !this.status) {
      return 'Every billing cancellation is settled';
    }
    return this.filtered ? 'No organization matches' : 'No organizations yet';
  }

  ngOnInit(): void {
    const state = listStateFromParams(this.route.snapshot.queryParamMap);
    this.q = state.q;
    this.status = state.status;
    this.billing = state.billing;
    this.page = state.page;
    this.queryParams = listQueryParams(state);

    this.typed$
      .pipe(
        debounceTime(300),
        map(text => text.trim()),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(q => {
        if (q !== this.q) {
          this.q = q;
          this.page = 1;
          this.reload();
        }
      });

    // A newer query drops the answer to an older one
    this.load$
      .pipe(
        switchMap(
          (query): Observable<Loaded> =>
            this.operator.organizations(query).pipe(
              map(page => ({ page })),
              catchError(error => of({ error })),
            ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(result => {
        this.loading = false;
        if ('error' in result) {
          // Never the rows of an earlier query under this one's search and filters
          this.rows = undefined;
          this.total = 0;
          this.errorMessage = organizationErrorMessage(result.error);
          return;
        }
        this.rows = result.page.data;
        this.total = result.page.meta.total;
      });

    this.load();
  }

  typed(text: string): void {
    this.typed$.next(text);
  }

  setStatus(status: OperatorStatusFilter): void {
    if (status !== this.status) {
      this.status = status;
      this.page = 1;
      this.reload();
    }
  }

  setBilling(billing: OperatorBillingFilter): void {
    if (billing !== this.billing) {
      this.billing = billing;
      this.page = 1;
      this.reload();
    }
  }

  goTo(page: number): void {
    if (page !== this.page) {
      this.page = page;
      this.reload();
    }
  }

  retry(): void {
    this.load();
  }

  trackById(_: number, row: OperatorOrganization): string {
    return row.id;
  }

  private reload(): void {
    this.queryParams = listQueryParams({ q: this.q, status: this.status, billing: this.billing, page: this.page });
    this.router.navigate([], { relativeTo: this.route, queryParams: this.queryParams, replaceUrl: true });
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.errorMessage = undefined;
    this.load$.next({ q: this.q, status: this.status, billing: this.billing, page: this.page, limit: this.pageSize });
  }
}
