import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { Payload } from '../../shared/models/http';
import { environment } from '../../../environments/environment';

/** The state of the anonymous usage statistics, as the API reports it to the instance operator. */
export interface EverStatsStatus {
  enabled: boolean;
  reason: 'env' | 'ui' | 'cloud-managed' | 'no-destination';
  toggleEnabled: boolean;
  toggleReadOnly: boolean;
  destinationUsable: boolean;
  nextSendAt: number | null;
  lastSentAt: number | null;
  lastStatus: string | null;
  instanceId: string | null;
  keyId: string | null;
  keyState: 'ok' | 'key_unreadable' | 'secret_missing' | null;
  country: string;
  installSource: string;
  version: string;
  channel: string;
}

/** One stored report: the exact bytes sent and Ever Platform's answer. */
export interface EverStatsReport {
  reportId: string;
  period: string;
  final: boolean;
  payload: string;
  createdAt: number;
  sentAt: number | null;
  httpStatus: number | null;
  status: string;
  attempts: number;
  error: string | null;
  hint: string | null;
}

export interface EverStatsPreview {
  valid: boolean;
  error: string | null;
  payload: Record<string, unknown>;
}

@Injectable({
  providedIn: 'root',
})
export class EverStatsService {
  private endpoint = `${environment.apiEndpoint}/ever-stats`;

  constructor(private http: HttpClient) {}

  /**
   * Whether the signed-in user operates this installation and the statistics module is loaded: the status answers only
   * then. Any other answer (not found, an error, or not the expected body) means no.
   */
  isAvailable(): Observable<boolean> {
    return this.http.get<Payload<EverStatsStatus>>(`${this.endpoint}/status`).pipe(
      map(res => !!res && !!res.data && typeof res.data.enabled === 'boolean'),
      catchError(() => of(false)),
    );
  }

  status(): Observable<EverStatsStatus> {
    return this.http.get<Payload<EverStatsStatus>>(`${this.endpoint}/status`).pipe(map(res => res.data));
  }

  preview(): Observable<EverStatsPreview> {
    return this.http.post<Payload<EverStatsPreview>>(`${this.endpoint}/preview`, {}).pipe(map(res => res.data));
  }

  reports(): Observable<EverStatsReport[]> {
    return this.http.get<Payload<EverStatsReport[]>>(`${this.endpoint}/reports`).pipe(map(res => res.data));
  }

  sendNow(): Observable<EverStatsReport> {
    return this.http.post<Payload<EverStatsReport>>(`${this.endpoint}/send`, {}).pipe(map(res => res.data));
  }

  setEnabled(enabled: boolean): Observable<boolean> {
    return this.http.put<Payload<{ enabled: boolean }>>(`${this.endpoint}/enabled`, { enabled }).pipe(map(res => res.data.enabled));
  }

  resetIdentity(): Observable<{ instanceId: string; keyId: string }> {
    return this.http.post<Payload<{ instanceId: string; keyId: string }>>(`${this.endpoint}/reset-identity`, {}).pipe(map(res => res.data));
  }
}
