import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { Payload } from '../../shared/models/http';

/** What the API answers for an intent that verifies: the sealed confirmation and the organization to show. */
export interface ProvisionIntent {
  provisionTxn: string;
  jti: string;
  handle: string;
  displayName: string;
  expiresAt: number;
}

/** The answer to a confirmation or a refusal. */
export interface ProvisionResult {
  status: 'created' | 'exists' | 'refused';
  projectId?: string;
  returnTo: string | null;
}

/** Where the page keeps the intent for this tab while the person signs in (never in the address bar again). */
export const PROVISION_INTENT_KEY = 'everConnectProvisionIntent';

/** How long the kept intent is used (an intent itself lives at most 15 minutes). */
const KEPT_MS = 15 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class ProvisionService {
  private readonly endpoint = `${environment.apiEndpoint}/ever-connect/provision`;

  constructor(private readonly http: HttpClient) {}

  intent(intent: string): Observable<ProvisionIntent> {
    return this.http.post<Payload<ProvisionIntent>>(`${this.endpoint}/intent`, { intent }).pipe(map(res => res.data));
  }

  confirm(provisionTxn: string): Observable<ProvisionResult> {
    return this.http.post<Payload<ProvisionResult>>(`${this.endpoint}/confirm`, { provisionTxn }).pipe(map(res => res.data));
  }

  reject(jti: string, provisionTxn: string): Observable<ProvisionResult> {
    return this.http
      .post<Payload<ProvisionResult>>(`${this.endpoint}/intents/${encodeURIComponent(jti)}/reject`, { provisionTxn })
      .pipe(map(res => res.data));
  }

  /** Keeps the intent for this tab only (session storage). */
  keep(intent: string): void {
    sessionStorage.setItem(PROVISION_INTENT_KEY, JSON.stringify({ intent, at: Date.now() }));
  }

  /** The intent kept for this tab, while it is recent. */
  kept(): string | null {
    try {
      const kept = JSON.parse(sessionStorage.getItem(PROVISION_INTENT_KEY) || 'null');
      return kept && typeof kept.intent === 'string' && Date.now() - kept.at < KEPT_MS ? kept.intent : null;
    } catch {
      return null;
    }
  }

  forget(): void {
    sessionStorage.removeItem(PROVISION_INTENT_KEY);
  }
}
