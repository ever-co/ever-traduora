import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Payload } from '../../shared/models/http';
import { BillingOrder, OrganizationBilling } from './billing.model';

/** The billing routes of an organization (owner and admins read; the owner changes) */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private readonly endpoint = environment.apiEndpoint;

  constructor(private readonly http: HttpClient) {}

  find(organizationId: string): Observable<OrganizationBilling> {
    return this.http.get<Payload<OrganizationBilling>>(`${this.endpoint}/organizations/${organizationId}/billing`).pipe(map(res => res.data));
  }

  /** The Stripe Checkout page for the order */
  checkout(organizationId: string, order: BillingOrder): Observable<string> {
    return this.http
      .post<Payload<{ url: string }>>(`${this.endpoint}/organizations/${organizationId}/billing/checkout`, order)
      .pipe(map(res => res.data.url));
  }

  /** A raise is invoiced at once and applies once that invoice is paid: `pending` until then */
  changeSubscription(organizationId: string, order: BillingOrder): Observable<{ pending: boolean }> {
    return this.http
      .patch<Payload<{ pending: boolean }>>(`${this.endpoint}/organizations/${organizationId}/billing/subscription`, order)
      .pipe(map(res => res.data));
  }

  /** The Stripe customer portal page */
  portal(organizationId: string): Observable<string> {
    return this.http
      .post<Payload<{ url: string }>>(`${this.endpoint}/organizations/${organizationId}/billing/portal`, {})
      .pipe(map(res => res.data.url));
  }
}
