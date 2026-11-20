import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Payload } from '../../shared/models/http';
import { environment } from '../../../environments/environment';

/** The Ever Platform pages the operator of this installation has. */
export interface EverPlatformPages {
  stats: boolean;
  connect: boolean;
}

/** The state of the Ever Platform connection, as the API reports it to the instance operator. */
export interface EverConnectStatus {
  connected: boolean;
  status: string;
  registryInstanceId: string | null;
  orgId: string | null;
  linkId: string | null;
  linkState: string | null;
  displayName: string | null;
  connectedAt: number | null;
  lastHeartbeatAt: number | null;
  entitlement: { state: 'valid' | 'stale' | 'paused' | 'none'; tier: string | null; expiresAt: number | null; error: string | null };
  installSource: string;
  destinationUsable: boolean;
}

/** One row of what an integration moves, as app.ever.co shows it on its consent screen. */
export interface EverConnectScopeRow {
  field_path: string;
  direction: string;
  form: string;
  frequency: string;
  purpose: string;
}

export interface EverConnectIntegration {
  key: string;
  name: string;
  description: string;
  state: string;
  consentId: string | null;
  pendingRemoteRevoke: boolean;
  deniedHere: boolean;
  config: { base_url?: string };
  scope: EverConnectScopeRow[];
}

export interface EverConnectAuditRow {
  at: number;
  action: string;
  actor: string;
  detail: string | null;
}

/** A weekly window maintenance operations may run in, in UTC: the days (0 = Sunday) and the hours `from` to `to` (`HH:MM`). */
export interface EverManagedWindow {
  days: number[];
  from: string;
  to: string;
}

/** One maintenance operation requested from app.ever.co and what became of it (no path, no file name). */
export interface EverManagedOperation {
  operationId: string;
  kind: string;
  status: string;
  reason: string | null;
  sizeBytes: number | null;
  at: number;
}

/** The operator's opt-in to maintenance operations, as the API shows it (the backup directory only as set or not). */
export interface EverManagedView {
  available: boolean;
  optIn: boolean;
  kinds: string[];
  supportedKinds: string[];
  windows: EverManagedWindow[];
  backupDirSet: boolean;
  history: EverManagedOperation[];
}

/** A change of the opt-in: the fields not given keep their value; an empty `backupDir` removes the directory. */
export interface EverManagedUpdate {
  optIn?: boolean;
  kinds?: string[];
  windows?: EverManagedWindow[];
  backupDir?: string;
}

/** An export of the signed-in user's own account, made for a request the user sent from app.ever.co. */
export interface EverPersonExport {
  jobId: string;
  createdAt: number;
  expiresAt: number;
}

@Injectable({
  providedIn: 'root',
})
export class EverPlatformService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  /**
   * The pages the signed-in user has: only the operator of the installation gets an answer, and only when an Ever
   * Platform module is loaded. Any other answer (not found, an error, or not the expected body) means none.
   */
  pages(): Observable<EverPlatformPages | null> {
    return this.http.get<Payload<EverPlatformPages>>(`${this.endpoint}/ever-platform/status`).pipe(
      map(res =>
        res && res.data && typeof res.data.stats === 'boolean' && typeof res.data.connect === 'boolean' && (res.data.stats || res.data.connect)
          ? res.data
          : null,
      ),
      catchError(() => of(null)),
    );
  }

  status(): Observable<EverConnectStatus> {
    return this.http.get<Payload<EverConnectStatus>>(`${this.endpoint}/ever-connect/status`).pipe(map(res => res.data));
  }

  connect(code: string, displayName: string): Observable<EverConnectStatus> {
    return this.http.post<Payload<EverConnectStatus>>(`${this.endpoint}/ever-connect/connect`, { code, displayName }).pipe(map(res => res.data));
  }

  disconnect(): Observable<EverConnectStatus> {
    return this.http.post<Payload<EverConnectStatus>>(`${this.endpoint}/ever-connect/disconnect`, {}).pipe(map(res => res.data));
  }

  refreshEntitlement(): Observable<unknown> {
    return this.http.post<Payload<unknown>>(`${this.endpoint}/ever-connect/entitlement/refresh`, {}).pipe(map(res => res.data));
  }

  integrations(): Observable<EverConnectIntegration[]> {
    return this.http.get<Payload<EverConnectIntegration[]>>(`${this.endpoint}/ever-connect/integrations`).pipe(map(res => res.data));
  }

  refreshIntegrations(): Observable<EverConnectIntegration[]> {
    return this.http.post<Payload<EverConnectIntegration[]>>(`${this.endpoint}/ever-connect/integrations/refresh`, {}).pipe(map(res => res.data));
  }

  consentUrl(key: string): Observable<string> {
    return this.http
      .get<Payload<{ url: string }>>(`${this.endpoint}/ever-connect/integrations/${encodeURIComponent(key)}/consent-url`)
      .pipe(map(res => res.data.url));
  }

  accept(key: string, accepted: boolean): Observable<EverConnectIntegration[]> {
    return this.http
      .post<Payload<EverConnectIntegration[]>>(`${this.endpoint}/ever-connect/integrations/${encodeURIComponent(key)}/accept`, { accepted })
      .pipe(map(res => res.data));
  }

  disable(key: string): Observable<EverConnectIntegration[]> {
    return this.http
      .post<Payload<EverConnectIntegration[]>>(`${this.endpoint}/ever-connect/integrations/${encodeURIComponent(key)}/disable`, {})
      .pipe(map(res => res.data));
  }

  setPublicUrl(url: string): Observable<EverConnectIntegration[]> {
    return this.http.put<Payload<EverConnectIntegration[]>>(`${this.endpoint}/ever-connect/public-url`, { url }).pipe(map(res => res.data));
  }

  clearPublicUrl(): Observable<EverConnectIntegration[]> {
    return this.http.delete<Payload<EverConnectIntegration[]>>(`${this.endpoint}/ever-connect/public-url`).pipe(map(res => res.data));
  }

  audit(): Observable<EverConnectAuditRow[]> {
    return this.http.get<Payload<EverConnectAuditRow[]>>(`${this.endpoint}/ever-connect/audit`).pipe(map(res => res.data));
  }

  /** The opt-in to maintenance operations and their history (operator only; 404 where Ever operates the installation). */
  managed(): Observable<EverManagedView> {
    return this.http.get<Payload<EverManagedView>>(`${this.endpoint}/ever-connect/managed`).pipe(map(res => res.data));
  }

  updateManaged(update: EverManagedUpdate): Observable<EverManagedView> {
    return this.http.put<Payload<EverManagedView>>(`${this.endpoint}/ever-connect/managed`, update).pipe(map(res => res.data));
  }

  /**
   * The signed-in user's own exports that can be downloaded now. Any signed-in user may ask; the route exists only while
   * the connection module is loaded, so a 404 means it is not.
   */
  myExports(): Observable<EverPersonExport[]> {
    return this.http.get<Payload<EverPersonExport[]>>(`${this.endpoint}/ever-connect/me/exports`).pipe(map(res => res.data));
  }

  /** One export of the signed-in user's own account, as JSON (404 once it expired). */
  myExport(jobId: string): Observable<unknown> {
    return this.http.get<Payload<unknown>>(`${this.endpoint}/ever-connect/me/exports/${encodeURIComponent(jobId)}`).pipe(map(res => res.data));
  }
}
