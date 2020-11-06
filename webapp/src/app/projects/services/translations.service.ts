import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { Payload } from 'src/app/shared/models/http';
import { environment } from '../../../environments/environment';
import { Locale } from '../models/locale';
import { ProjectLocale } from '../models/project-locale';
import { Translation } from '../models/translation';

@Injectable({
  providedIn: 'root',
})
export class ProjectTranslationsService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  loadKnownLocales(): Observable<Locale[]> {
    return this.http.get<Payload<Locale[]>>(`${this.endpoint}/locales`).pipe(map(res => res.data));
  }

  findProjectLocales(projectId: string): Observable<ProjectLocale[]> {
    return this.http.get<Payload<ProjectLocale[]>>(`${this.endpoint}/projects/${projectId}/translations`).pipe(map(res => res.data));
  }

  addProjectLocale(projectId: string, localeCode: string): Observable<ProjectLocale> {
    return this.http
      .post<Payload<ProjectLocale>>(`${this.endpoint}/projects/${projectId}/translations`, { code: localeCode })
      .pipe(map(res => res.data));
  }

  deleteProjectLocale(projectId: string, localeCode: string): Observable<void> {
    return this.http.delete<void>(`${this.endpoint}/projects/${projectId}/translations/${localeCode}`);
  }

  autoTranslateProjectLocale(projectId: string, localeCode: string): Observable<void> {
    return this.http.get<void>(`${this.endpoint}/projects/${projectId}/translations/autotranslate/${localeCode}`);
  }

  findProjectTranslation(projectId: string, localeCode: string): Observable<Translation[]> {
    return this.http.get<Payload<Translation[]>>(`${this.endpoint}/projects/${projectId}/translations/${localeCode}`).pipe(map(res => res.data));
  }

  updateTranslation(projectId: string, localeCode: string, termId: string, value: string): Observable<Translation> {
    return this.http
      .patch<Payload<Translation>>(`${this.endpoint}/projects/${projectId}/translations/${localeCode}`, {
        termId,
        value,
      })
      .pipe(map(res => res.data));
  }
}
