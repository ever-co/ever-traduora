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

/** Where the page keeps the checked confirmation for this tab, until its outcome is known. */
export const PROVISION_CHECKED_KEY = 'everConnectProvisionChecked';

/** Writes to session storage; false when the browser blocks it or it is full (the page then works without it). */
function write(key: string, value: string): boolean {
  try {
    sessionStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

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

  /** Keeps the intent for this tab only (session storage); false when the browser does not let the page keep it. */
  keep(intent: string): boolean {
    return write(PROVISION_INTENT_KEY, JSON.stringify({ intent, at: Date.now() }));
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

  /**
   * Keeps the checked confirmation for this tab until its outcome is known: after a reload (a lost answer to Create,
   * for instance) the page confirms again with it, which answers `exists`, instead of checking the used intent again.
   */
  keepChecked(checked: ProvisionIntent): boolean {
    return write(PROVISION_CHECKED_KEY, JSON.stringify(checked));
  }

  /** The checked confirmation kept for this tab, while it is valid. */
  checkedKept(): ProvisionIntent | null {
    try {
      const checked = JSON.parse(sessionStorage.getItem(PROVISION_CHECKED_KEY) || 'null');
      const valid = checked && typeof checked.provisionTxn === 'string' && typeof checked.jti === 'string' && checked.expiresAt > Date.now();
      return valid ? checked : null;
    } catch {
      return null;
    }
  }

  /** Forgets the intent and its confirmation (the outcome is known, or the link cannot be used). */
  forget(): void {
    for (const key of [PROVISION_INTENT_KEY, PROVISION_CHECKED_KEY]) {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // Storage the browser blocks holds nothing to forget
      }
    }
  }
}
