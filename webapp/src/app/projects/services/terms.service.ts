import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { environment } from '../../../environments/environment';
import { Term } from '../models/term';

@Injectable({
  providedIn: 'root',
})
export class ProjectTermsService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  find(projectId: string): Observable<Term[]> {
    return this.http.get<Payload<Term[]>>(`${this.endpoint}/projects/${projectId}/terms`).pipe(map(res => res.data));
  }

  create(projectId: string, value: string): Observable<Term> {
    return this.http
      .post<Payload<Term>>(`${this.endpoint}/projects/${projectId}/terms`, { value })
      .pipe(map(res => res.data));
  }

  update(projectId: string, termId: string, value: string): Observable<Term> {
    return this.http
      .patch<Payload<Term>>(`${this.endpoint}/projects/${projectId}/terms/${termId}`, { value })
      .pipe(map(res => res.data));
  }

  delete(projectId: string, termId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/terms/${termId}`);
  }
}
