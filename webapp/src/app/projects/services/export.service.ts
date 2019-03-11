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

  export(projectId: string, localeCode: string, format: string): Observable<any> {
    return this.http.get(`${this.endpoint}/projects/${projectId}/exports?locale=${localeCode}&format=${format}`, {
      responseType: 'blob',
    });
  }

  exportAndDownload(projectId: string, localeCode: string, format: ExportFormat): Observable<any> {
    return this.export(projectId, localeCode, format.code).pipe(tap(data => saveAs(data, `${localeCode}.${format.extension}`)));
  }
}
