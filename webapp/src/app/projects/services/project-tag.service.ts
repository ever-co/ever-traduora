import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { environment } from '../../../environments/environment';
import { Tag } from '../models/tag';

@Injectable({
  providedIn: 'root',
})
export class ProjectTagService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  find(projectId: string): Observable<Tag[]> {
    return this.http.get<Payload<Tag[]>>(`${this.endpoint}/projects/${projectId}/tags`).pipe(map(res => res.data));
  }

  create(projectId: string, value: String, color: string): Observable<Tag> {
    return this.http.post<Payload<Tag>>(`${this.endpoint}/projects/${projectId}/tags`, { value, color }).pipe(map(res => res.data));
  }

  update(projectId: string, tagId: string, value: String, color: string): Observable<Tag> {
    return this.http.patch<Payload<Tag>>(`${this.endpoint}/projects/${projectId}/tags/${tagId}`, { value, color }).pipe(map(res => res.data));
  }

  remove(projectId: string, tagId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/tags/${tagId}`);
  }

  tagTerm(projectId: string, tagId: String, termId: string): Observable<void> {
    return this.http.post<void>(`${this.endpoint}/projects/${projectId}/tags/${tagId}/terms/${termId}`, {});
  }

  untagTerm(projectId: string, tagId: String, termId: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/tags/${tagId}/terms/${termId}`);
  }

  tagTranslation(projectId: string, tagId: String, termId: string, localeCode: string): Observable<void> {
    return this.http.post<void>(`${this.endpoint}/projects/${projectId}/tags/${tagId}/terms/${termId}/translations/${localeCode}`, {});
  }

  untagTranslation(projectId: string, tagId: String, termId: string, localeCode: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/tags/${tagId}/terms/${termId}/translations/${localeCode}`);
  }
}
