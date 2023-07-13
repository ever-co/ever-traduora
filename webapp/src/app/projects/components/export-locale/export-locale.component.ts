import { Component, Input, OnInit } from '@angular/core';
import { throwError } from 'rxjs';
import { catchError, finalize } from 'rxjs/operators';
import { errorToMessage } from '../../../shared/util/api-error';
import { ExportFormat, EXPORT_FORMATS } from '../../models/export';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
import { ExportService } from '../../services/export.service';

@Component({
  selector: 'app-export-locale',
  templateUrl: './export-locale.component.html',
  styleUrls: ['./export-locale.component.css'],
})
export class ExportLocaleComponent implements OnInit {
  @Input()
  project: Project;

  @Input()
  locales: Locale[];

  @Input()
  loading = false;

  selectedLocale: Locale;
  selectedFallbackLocale?: Locale;
  selectedFormat: ExportFormat;
  availableFormats = EXPORT_FORMATS;
  untranslated = false;

  errorMessage: string;

  constructor(private exportService: ExportService) {}

  ngOnInit() {}

  validInputs() {
    return !!this.selectedFormat && !!this.selectedLocale;
  }

  selectLocale(locale: Locale) {
    this.selectedLocale = locale;
  }

  selectFallbackLocale(locale: Locale) {
    this.selectedFallbackLocale = locale;
  }

  async export() {
    if (!this.validInputs()) {
      return;
    }

    this.errorMessage = undefined;
    this.loading = true;

    await this.exportService
      .exportAndDownload(this.project.id, this.selectedLocale.code, this.selectedFormat, this.untranslated, this.selectedFallbackLocale?.code)
      .pipe(
        catchError(error => {
          console.error(error);
          this.errorMessage = errorToMessage(error, 'ExportLocale');
          return throwError(error);
        }),
        finalize(() => (this.loading = false)),
      )
      .toPromise();
  }
}
