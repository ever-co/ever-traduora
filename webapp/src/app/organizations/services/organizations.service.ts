import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from '../../shared/models/http';
import { environment } from '../../../environments/environment';
import { Organization, OrganizationInvite, OrganizationMember, OrganizationRole } from '../models/organization';

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
