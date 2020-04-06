import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { environment } from '../../../environments/environment';
import { ProjectClient } from '../models/project-client';
import { ProjectRole } from '../models/project-role';

@Injectable({
  providedIn: 'root',
})
export class ProjectClientService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  find(projectId: string): Observable<ProjectClient[]> {
    return this.http.get<Payload<ProjectClient[]>>(`${this.endpoint}/projects/${projectId}/clients`).pipe(map(res => res.data));
  }

  create(projectId: string, name: String, role: ProjectRole): Observable<ProjectClient> {
    return this.http
      .post<Payload<ProjectClient>>(`${this.endpoint}/projects/${projectId}/clients`, { name, role })
      .pipe(map(res => res.data));
  }

  update(projectId: string, userId: String, role: ProjectRole): Observable<ProjectClient> {
    return this.http
      .patch<Payload<ProjectClient>>(`${this.endpoint}/projects/${projectId}/clients/${userId}`, { role })
      .pipe(map(res => res.data));
  }

  remove(projectId: string, userId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/clients/${userId}`);
  }
}
