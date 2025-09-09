import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Payload } from '../../shared/models/http';
import { ImportFormat, ImportResult } from '../models/import';
import { Locale } from '../models/locale';

@Injectable({
  providedIn: 'root',
})
export class ImportService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  import(projectId: string, locale: Locale, format: ImportFormat, file: File): Observable<Payload<ImportResult>> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<Payload<ImportResult>>(`${this.endpoint}/projects/${projectId}/imports?format=${format.code}&locale=${locale.code}`, form);
  }
}
