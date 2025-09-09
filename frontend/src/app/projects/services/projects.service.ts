import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { Plan } from '../models/plan';
import { Project } from '../models/project';
import { environment } from './../../../environments/environment';

@Injectable({
  providedIn: 'root',
})
export class ProjectsService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  find(): Observable<Project[]> {
    return this.http.get<Payload<Project[]>>(`${this.endpoint}/projects`).pipe(map(res => res.data));
  }

  findOne(id: string): Observable<Project> {
    return this.http.get<Payload<Project>>(`${this.endpoint}/projects/${id}`).pipe(map(res => res.data));
  }

  findPlan(projectId: string): Observable<Plan> {
    return this.http.get<Payload<Plan>>(`${this.endpoint}/projects/${projectId}/plan`).pipe(map(res => res.data));
  }

  create(data: { name: string; description?: string }): Observable<Project> {
    return this.http.post<Payload<Project>>(`${this.endpoint}/projects`, data).pipe(map(res => res.data));
  }

  update(id: string, data: { name?: string; description?: string }): Observable<Project> {
    return this.http.patch<Payload<Project>>(`${this.endpoint}/projects/${id}`, data).pipe(map(res => res.data));
  }

  delete(id: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${id}`);
  }
}
