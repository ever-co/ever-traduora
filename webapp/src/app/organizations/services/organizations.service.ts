import { HttpClient, HttpErrorResponse, HttpEvent } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { from, Observable, throwError } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { Payload } from '../../shared/models/http';
import { environment } from '../../../environments/environment';
import { Organization, OrganizationInvite, OrganizationMember, OrganizationRole, OrganizationUsage } from '../models/organization';

/**
 * A download's error arrives with its body as a blob: read as JSON, its code reaches the messages. The error stays as it
 * is when the body cannot be read.
 */
async function withJsonErrorBody(error: unknown): Promise<unknown> {
  if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) {
    return error;
  }
  try {
    return new HttpErrorResponse({
      error: JSON.parse(await error.error.text()),
      headers: error.headers,
      status: error.status,
      statusText: error.statusText,
      url: error.url ?? undefined,
    });
  } catch {
    return error;
  }
}

@Injectable({ providedIn: 'root' })
export class OrganizationsService {
  private readonly endpoint = environment.apiEndpoint;

  constructor(private readonly http: HttpClient) {}

  find(): Observable<Organization[]> {
    return this.http.get<Payload<Organization[]>>(`${this.endpoint}/organizations`).pipe(map(res => res.data));
  }

  create(data: { name: string; slug?: string }): Observable<Organization> {
    return this.http.post<Payload<Organization>>(`${this.endpoint}/organizations`, data).pipe(map(res => res.data));
  }

  update(id: string, data: { name?: string; slug?: string }): Observable<Organization> {
    return this.http.patch<Payload<Organization>>(`${this.endpoint}/organizations/${id}`, data).pipe(map(res => res.data));
  }

  /**
   * The organization's data as one zip, built on the fly (owner, admin): the download's progress, then the file. Asked
   * through the HTTP client, so the request carries the session like any other.
   */
  exportArchive(id: string): Observable<HttpEvent<Blob>> {
    return this.http
      .get(`${this.endpoint}/organizations/${id}/export`, { responseType: 'blob', observe: 'events', reportProgress: true })
      .pipe(catchError(error => from(withJsonErrorBody(error)).pipe(mergeMap(readable => throwError(() => readable)))));
  }

  /** Deletes the organization (owner only), confirmed by its address as the owner typed it. */
  remove(id: string, slug: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/organizations/${id}`, { body: { slug } });
  }

  members(id: string): Observable<OrganizationMember[]> {
    return this.http.get<Payload<OrganizationMember[]>>(`${this.endpoint}/organizations/${id}/members`).pipe(map(res => res.data));
  }

  updateMember(id: string, userId: string, role: OrganizationRole): Observable<OrganizationMember> {
    return this.http
      .patch<Payload<OrganizationMember>>(`${this.endpoint}/organizations/${id}/members/${userId}`, { role })
      .pipe(map(res => res.data));
  }

  removeMember(id: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/organizations/${id}/members/${userId}`);
  }

  transferOwnership(id: string, userId: string): Observable<OrganizationMember[]> {
    return this.http
      .post<Payload<OrganizationMember[]>>(`${this.endpoint}/organizations/${id}/transfer-ownership`, { userId })
      .pipe(map(res => res.data));
  }

  /** The plan, seats and strings of the organization (owner, admin). */
  usage(id: string): Observable<OrganizationUsage> {
    return this.http.get<Payload<OrganizationUsage>>(`${this.endpoint}/organizations/${id}/usage`).pipe(map(res => res.data));
  }

  invites(id: string): Observable<OrganizationInvite[]> {
    return this.http.get<Payload<OrganizationInvite[]>>(`${this.endpoint}/organizations/${id}/invites`).pipe(map(res => res.data));
  }

  /** An account with a verified email joins at once (a member comes back), anyone else gets an invite with its link. */
  invite(id: string, email: string, role: OrganizationRole): Observable<OrganizationMember | OrganizationInvite> {
    return this.http
      .post<Payload<OrganizationMember | OrganizationInvite>>(`${this.endpoint}/organizations/${id}/invites`, { email, role })
      .pipe(map(res => res.data));
  }

  revokeInvite(id: string, inviteId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/organizations/${id}/invites/${inviteId}`);
  }

  acceptInvite(inviteToken: string): Observable<{ organizationId: string; slug: string; role: OrganizationRole }> {
    return this.http
      .post<Payload<{ organizationId: string; slug: string; role: OrganizationRole }>>(`${this.endpoint}/auth/accept-organization-invite`, {
        inviteToken,
      })
      .pipe(map(res => res.data));
  }
}
