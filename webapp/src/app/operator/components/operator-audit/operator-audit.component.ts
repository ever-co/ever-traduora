import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgbPagination } from '@ng-bootstrap/ng-bootstrap';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap, tap } from 'rxjs/operators';
import { organizationErrorMessage } from '../../../organizations/models/organization-errors';
import { OPERATOR_PAGE_SIZE, OperatorAuditEntry, OperatorPage, pageFromParam } from '../../models/operator';
import { OperatorService } from '../../services/operator.service';

type Loaded = { page: OperatorPage<OperatorAuditEntry> } | { error: unknown };

const figures = new Intl.NumberFormat('en-US');

/** /operator/audit: every suspension and restore, newest first; `?organizationId=` keeps it to one organization. */
@Component({
  selector: 'app-operator-audit',
  imports: [NgIf, NgFor, DatePipe, RouterLink, NgbPagination],
  templateUrl: './operator-audit.component.html',
  styleUrls: ['../../operator-common.css'],
})
export class OperatorAuditComponent implements OnInit {
  readonly pageSize = OPERATOR_PAGE_SIZE;

  organizationId: string | undefined;
  page = 1;
  rows: OperatorAuditEntry[] | undefined;
  total = 0;
  errorMessage: string | undefined;

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
    return `${figures.format(this.total)} ${this.total === 1 ? 'action' : 'actions'}`;
  }

  ngOnInit(): void {
    // The address is the query: the page and the organization come from it, and a link or the way back sets them
    this.route.queryParamMap
      .pipe(
        map(params => ({ organizationId: params.get('organizationId') || undefined, page: pageFromParam(params.get('page')) })),
        tap(query => {
          this.organizationId = query.organizationId;
          this.page = query.page;
          this.errorMessage = undefined;
        }),
        switchMap(query => this.fetch(query.organizationId, query.page)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(result => this.show(result));
  }

  goTo(page: number): void {
    if (page !== this.page) {
      this.router.navigate([], { relativeTo: this.route, queryParams: { page: page > 1 ? page : null }, queryParamsHandling: 'merge' });
    }
  }

  retry(): void {
    this.errorMessage = undefined;
    this.fetch(this.organizationId, this.page).subscribe(result => this.show(result));
  }

  trackById(_: number, row: OperatorAuditEntry): string {
    return row.id;
  }

  private fetch(organizationId: string | undefined, page: number): Observable<Loaded> {
    return this.operator.audit({ organizationId, page, limit: this.pageSize }).pipe(
      map(answer => ({ page: answer })),
      catchError(error => of({ error })),
    );
  }

  private show(result: Loaded): void {
    if ('error' in result) {
      this.errorMessage = organizationErrorMessage(result.error);
      return;
    }
    this.rows = result.page.data;
    this.total = result.page.meta.total;
  }
}
