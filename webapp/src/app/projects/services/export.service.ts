import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { saveAs } from 'file-saver';
import { from, Observable, throwError } from 'rxjs';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import { environment } from '../../../environments/environment';
import { ExportFormat } from '../models/export';

/**
 * The export downloads as a blob, so the body of an error arrives as a blob too. For a 400 the API names in it the terms
 * the format cannot hold: read it as JSON so that errorToMessage can show the message. Keeps the error as it is when the
 * body cannot be read.
 */
async function withJsonErrorBody(error: any): Promise<any> {
  if (!(error instanceof HttpErrorResponse) || error.status !== 400 || !(error.error instanceof Blob)) {
    return error;
  }
  try {
    const body = JSON.parse(await error.error.text());
    return new HttpErrorResponse({
      error: body,
      headers: error.headers,
      status: error.status,
      statusText: error.statusText,
      url: error.url ?? undefined,
    });
  } catch {
    return error;
  }
}

@Injectable({
  providedIn: 'root',
})
export class ExportService {
  private endpoint = environment.apiEndpoint;

  constructor(private http: HttpClient) {}

  export(projectId: string, localeCode: string, format: string, untranslated: boolean, fallbackLocale?: string): Observable<any> {
    const url = new URL(`${this.endpoint}/projects/${projectId}/exports?locale=${localeCode}&format=${format}&untranslated=${untranslated}`);

    if (fallbackLocale) {
      url.searchParams.append('fallbackLocale', fallbackLocale);
    }

    return this.http
      .get(url.toString(), {
        responseType: 'blob',
      })
      .pipe(catchError(error => from(withJsonErrorBody(error)).pipe(mergeMap(readable => throwError(() => readable)))));
  }

  exportAndDownload(
    projectId: string,
    localeCode: string,
    format: ExportFormat,
    untranslated: boolean,
    fallbackLocaleCode?: string,
  ): Observable<any> {
    return this.export(projectId, localeCode, format.code, untranslated, fallbackLocaleCode).pipe(
      tap(data => saveAs(data, `${localeCode}.${format.extension}`)),
    );
  }
}
