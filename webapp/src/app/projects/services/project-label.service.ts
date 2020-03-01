import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { environment } from '../../../environments/environment';
import { Label } from '../models/label';

@Injectable({
  providedIn: 'root',
})
export class ProjectLabelService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  find(projectId: string): Observable<Label[]> {
    return this.http.get<Payload<Label[]>>(`${this.endpoint}/projects/${projectId}/labels`).pipe(map(res => res.data));
  }

  create(projectId: string, value: String, color: string): Observable<Label> {
    return this.http
      .post<Payload<Label>>(`${this.endpoint}/projects/${projectId}/labels`, { value, color })
      .pipe(map(res => res.data));
  }

  update(projectId: string, labelId: string, value: String, color: string): Observable<Label> {
    return this.http
      .patch<Payload<Label>>(`${this.endpoint}/projects/${projectId}/labels/${labelId}`, { value, color })
      .pipe(map(res => res.data));
  }

  remove(projectId: string, labelId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/labels/${labelId}`);
  }

  labelTerm(projectId: string, labelId: String, termId: string): Observable<void> {
    return this.http.post<void>(`${this.endpoint}/projects/${projectId}/labels/${labelId}/terms/${termId}`, {});
  }

  unlabelTerm(projectId: string, labelId: String, termId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/labels/${labelId}/terms/${termId}`);
  }

  labelTranslation(projectId: string, labelId: String, termId: string, localeCode: string): Observable<void> {
    return this.http.post<void>(`${this.endpoint}/projects/${projectId}/labels/${labelId}/terms/${termId}/translations/${localeCode}`, {});
  }

  unlabelTranslation(projectId: string, labelId: String, termId: string, localeCode: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/labels/${labelId}/terms/${termId}/translations/${localeCode}`);
  }
}
