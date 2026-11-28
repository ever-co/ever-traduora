import { DatePipe, DecimalPipe, NgClass, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgbPagination } from '@ng-bootstrap/ng-bootstrap';
import { Observable, of, Subject } from 'rxjs';
import { catchError, debounceTime, map, switchMap } from 'rxjs/operators';
import { PLAN_NAMES } from '../../../organizations/models/organization';
import { organizationErrorMessage } from '../../../organizations/models/organization-errors';
import {
  OPERATOR_PAGE_SIZE,
  OperatorOrganization,
  OperatorOrganizationsQuery,
  OperatorPage,
  OperatorStatusFilter,
  pageFromParam,
  STATUS_FILTERS,
} from '../../models/operator';
import { OperatorService } from '../../services/operator.service';

type Loaded = { page: OperatorPage<OperatorOrganization> } | { error: unknown };

const figures = new Intl.NumberFormat('en-US');

/**
 * /operator/organizations: every organization of the installation, newest first, searched by name, address, id or the
 * owner's email and filtered by status. The search, the filter and the page are kept in the address, so the way back
 * from an organization lands on the same page.
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

  q = '';
  status: OperatorStatusFilter = '';
  page = 1;
  /** `undefined` until the first answer. */
  rows: OperatorOrganization[] | undefined;
  total = 0;
  loading = false;
  errorMessage: string | undefined;

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
    return !!(this.q || this.status);
  }

  ngOnInit(): void {
    const params = this.route.snapshot.queryParamMap;
    this.q = (params.get('q') ?? '').trim().slice(0, 100);
    const status = params.get('status') ?? '';
    this.status = STATUS_FILTERS.some(filter => filter.value === status) ? (status as OperatorStatusFilter) : '';
    this.page = pageFromParam(params.get('page'));

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
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q: this.q || null, status: this.status || null, page: this.page > 1 ? this.page : null },
      replaceUrl: true,
    });
    this.load();
  }

  private load(): void {
    this.loading = true;
    this.errorMessage = undefined;
    this.load$.next({ q: this.q, status: this.status, page: this.page, limit: this.pageSize });
  }
}
