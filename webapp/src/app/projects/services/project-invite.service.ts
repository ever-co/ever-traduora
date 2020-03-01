import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { environment } from '../../../environments/environment';
import { ProjectRole } from '../models/project-role';
import { ProjectInvite } from '../models/project-invite';

@Injectable({
  providedIn: 'root',
})
export class ProjectInviteService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  find(projectId: string): Observable<ProjectInvite[]> {
    return this.http.get<Payload<ProjectInvite[]>>(`${this.endpoint}/projects/${projectId}/invites`).pipe(map(res => res.data));
  }

  create(projectId: string, email: String, role: ProjectRole): Observable<ProjectInvite> {
    return this.http
      .post<Payload<ProjectInvite>>(`${this.endpoint}/projects/${projectId}/invites`, { email, role })
      .pipe(map(res => res.data));
  }

  update(projectId: string, inviteId: String, role: ProjectRole): Observable<ProjectInvite> {
    return this.http
      .patch<Payload<ProjectInvite>>(`${this.endpoint}/projects/${projectId}/invites/${inviteId}`, { role })
      .pipe(map(res => res.data));
  }

  remove(projectId: string, inviteId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/invites/${inviteId}`);
  }
}
