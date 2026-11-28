import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map, switchMap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { SaasModeService } from '../../organizations/services/saas-mode.service';
import { Payload } from '../../shared/models/http';
import {
  OperatorAuditEntry,
  OperatorAuditQuery,
  OperatorOrganization,
  OperatorOrganizationDetail,
  OperatorOrganizationsQuery,
  OperatorPage,
} from '../models/operator';

/** Only the set values, as query parameters. */
function paramsOf(query: Record<string, string | number | undefined>): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

/** The operator console (`/operator`): the installation's operators list, suspend and restore organizations. */
@Injectable({ providedIn: 'root' })
export class OperatorService {
  private readonly endpoint = environment.apiEndpoint;

  constructor(
    private readonly http: HttpClient,
    private readonly saasMode: SaasModeService,
  ) {}

  /**
   * Whether the signed-in person is an operator. Asked only in SaaS mode (the routes answer 404 otherwise). Any answer
   * but `{ operator: true }` means no: a 404 is how the API says "not an operator", never an error to show.
   */
  isOperator(): Observable<boolean> {
    return this.saasMode.saas$.pipe(
      switchMap(saas =>
        saas
          ? this.http.get<Payload<{ operator?: boolean }>>(`${this.endpoint}/operator/status`).pipe(
              map(res => res?.data?.operator === true),
              catchError(() => of(false)),
            )
          : of(false),
      ),
    );
  }

  organizations(query: OperatorOrganizationsQuery = {}): Observable<OperatorPage<OperatorOrganization>> {
    const params = paramsOf({ q: query.q?.trim(), status: query.status, billing: query.billing, page: query.page, limit: query.limit });
    return this.http.get<OperatorPage<OperatorOrganization>>(`${this.endpoint}/operator/organizations`, { params });
  }

  organization(id: string): Observable<OperatorOrganizationDetail> {
    return this.http
      .get<Payload<OperatorOrganizationDetail>>(`${this.endpoint}/operator/organizations/${encodeURIComponent(id)}`)
      .pipe(map(res => res.data));
  }

  /** Locks the members out at once; answers the detail with the new audit row first. */
  suspend(id: string, reason: string): Observable<OperatorOrganizationDetail> {
    return this.act(id, 'suspend', reason);
  }

  restore(id: string, reason: string): Observable<OperatorOrganizationDetail> {
    return this.act(id, 'restore', reason);
  }

  /** A deleted organization's address becomes free to take again (its record gets a generated one). */
  releaseSlug(id: string, reason: string): Observable<OperatorOrganizationDetail> {
    return this.act(id, 'release-slug', reason);
  }

  /** Tries the cancellation of a deleted organization's subscription again now; the detail says how it went. */
  retryBillingCancellation(id: string, reason: string): Observable<OperatorOrganizationDetail> {
    return this.act(id, 'billing-cancellation', reason);
  }

  audit(query: OperatorAuditQuery = {}): Observable<OperatorPage<OperatorAuditEntry>> {
    const params = paramsOf({ organizationId: query.organizationId, page: query.page, limit: query.limit });
    return this.http.get<OperatorPage<OperatorAuditEntry>>(`${this.endpoint}/operator/audit`, { params });
  }

  /** An audited operator action: the reason goes trimmed, the detail comes back with the new audit row first. */
  private act(id: string, action: string, reason: string): Observable<OperatorOrganizationDetail> {
    return this.http
      .post<Payload<OperatorOrganizationDetail>>(`${this.endpoint}/operator/organizations/${encodeURIComponent(id)}/${action}`, {
        reason: reason.trim(),
      })
      .pipe(map(res => res.data));
  }
}
