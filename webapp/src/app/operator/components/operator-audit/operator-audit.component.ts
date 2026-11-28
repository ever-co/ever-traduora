import { DatePipe, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { NgbPagination } from '@ng-bootstrap/ng-bootstrap';
import { Observable, of, Subject } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { organizationErrorMessage } from '../../../organizations/models/organization-errors';
import { auditActionLabel, OPERATOR_PAGE_SIZE, OperatorAuditEntry, OperatorPage, pageFromParam } from '../../models/operator';
import { OperatorService } from '../../services/operator.service';

type Loaded = { page: OperatorPage<OperatorAuditEntry> } | { error: unknown };

interface AuditQuery {
  organizationId: string | undefined;
  page: number;
}

const figures = new Intl.NumberFormat('en-US');

/** /operator/audit: every operator action, newest first; `?organizationId=` keeps it to one organization. */
@Component({
  selector: 'app-operator-audit',
  imports: [NgIf, NgFor, DatePipe, RouterLink, NgbPagination],
  templateUrl: './operator-audit.component.html',
  styleUrls: ['../../operator-common.css'],
})
export class OperatorAuditComponent implements OnInit {
  readonly pageSize = OPERATOR_PAGE_SIZE;
  readonly auditActionLabel = auditActionLabel;

  organizationId: string | undefined;
  page = 1;
  /** `undefined` until an answer for the current query. */
  rows: OperatorAuditEntry[] | undefined;
  total = 0;
  errorMessage: string | undefined;

  /** The query shown now; an answer for any other is dropped. */
  private query: AuditQuery = { organizationId: undefined, page: 1 };
  private readonly load$ = new Subject<AuditQuery>();

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
    // One load at a time: a newer query, or "Try again", drops the answer to an older one
    this.load$
      .pipe(
        switchMap(query => this.fetch(query).pipe(map(result => ({ query, result })))),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(({ query, result }) => {
        if (query === this.query) {
          this.show(result);
        }
      });

    // The address is the query: the page and the organization come from it, and a link or the way back sets them
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(params => {
      this.query = { organizationId: params.get('organizationId') || undefined, page: pageFromParam(params.get('page')) };
      this.organizationId = this.query.organizationId;
      this.page = this.query.page;
      // Nothing of the previous query stays on screen, not even when this one fails
      this.rows = undefined;
      this.total = 0;
      this.errorMessage = undefined;
      this.load$.next(this.query);
    });
  }

  goTo(page: number): void {
    if (page !== this.page) {
      this.router.navigate([], { relativeTo: this.route, queryParams: { page: page > 1 ? page : null }, queryParamsHandling: 'merge' });
    }
  }

  retry(): void {
    this.errorMessage = undefined;
    this.load$.next(this.query);
  }

  trackById(_: number, row: OperatorAuditEntry): string {
    return row.id;
  }

  private fetch(query: AuditQuery): Observable<Loaded> {
    return this.operator.audit({ organizationId: query.organizationId, page: query.page, limit: this.pageSize }).pipe(
      map(answer => ({ page: answer })),
      catchError(error => of({ error })),
    );
  }

  private show(result: Loaded): void {
    if ('error' in result) {
      this.rows = undefined;
      this.total = 0;
      this.errorMessage = organizationErrorMessage(result.error);
      return;
    }
    this.rows = result.page.data;
    this.total = result.page.meta.total;
  }
}
