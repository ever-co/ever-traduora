import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { saveAs } from 'file-saver';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ExportFormat } from '../models/export';

@Injectable({
  providedIn: 'root',
})
export class ExportService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  export(projectId: string, localeCode: string, format: string, fallbackLocale?: string): Observable<any> {
    const url = new URL(`${this.endpoint}/projects/${projectId}/exports?locale=${localeCode}&format=${format}`);

    if (fallbackLocale) {
      url.searchParams.append('fallbackLocale', fallbackLocale);
    }

    return this.http.get(url.toString(), {
      responseType: 'blob',
    });
  }

  exportAndDownload(projectId: string, localeCode: string, format: ExportFormat, fallbackLocaleCode?: string): Observable<any> {
    return this.export(projectId, localeCode, format.code, fallbackLocaleCode).pipe(tap(data => saveAs(data, `${localeCode}.${format.extension}`)));
  }
}
