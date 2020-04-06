import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { environment } from '../../../environments/environment';
import { ProjectRole } from '../models/project-role';
import { ProjectUser } from '../models/project-user';

@Injectable({
  providedIn: 'root',
})
export class ProjectUserService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  find(projectId: string): Observable<ProjectUser[]> {
    return this.http.get<Payload<ProjectUser[]>>(`${this.endpoint}/projects/${projectId}/users`).pipe(map(res => res.data));
  }

  create(projectId: string, email: String, role: ProjectRole): Observable<ProjectUser> {
    return this.http
      .post<Payload<ProjectUser>>(`${this.endpoint}/projects/${projectId}/users`, { email, role })
      .pipe(map(res => res.data));
  }

  update(projectId: string, userId: String, role: ProjectRole): Observable<ProjectUser> {
    return this.http
      .patch<Payload<ProjectUser>>(`${this.endpoint}/projects/${projectId}/users/${userId}`, { role })
      .pipe(map(res => res.data));
  }

  remove(projectId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/users/${userId}`);
  }
}
