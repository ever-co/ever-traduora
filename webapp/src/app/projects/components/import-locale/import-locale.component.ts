import { Component, EventEmitter, Input, OnInit, Output } from '@angular/core';
import { Navigate } from '@ngxs/router-plugin';
import { Store } from '@ngxs/store';
import * as _ from 'lodash';
import { errorToMessage } from '../../../shared/util/api-error';
import { ImportFormat, ImportResult, IMPORT_FORMATS } from '../../models/import';
import { Locale } from '../../models/locale';
import { Project } from '../../models/project';
import { ImportService } from '../../services/import.service';
import { RefreshProjectStats } from '../../stores/projects.state';

@Component({
  selector: 'app-import-locale',
  templateUrl: './import-locale.component.html',
  styleUrls: ['./import-locale.component.css'],
})
export class ImportLocaleComponent implements OnInit {
  @Input()
  project: Project;

  @Input()
  knownLocales: Locale[] = [];

  @Input()
  projectLocales: Locale[] = [];

  @Output()
  importSuccess = new EventEmitter<boolean>();

  @Input()
  loading = false;

  availableFormats = IMPORT_FORMATS;

  errorMessage: string;
  isHovering = false;

  selectedLocale: Locale | undefined = undefined;
  selectedFormat: ImportFormat | undefined = undefined;
  files: File[] = [];
  result: ImportResult | undefined = undefined;

  constructor(private importService: ImportService, private store: Store) {}

  ngOnInit() {}

  navigateToImportedLocale() {
    this.store.dispatch(new Navigate(['/projects', this.project.id, 'translations', this.selectedLocale.code]));
  }

  async import() {
    this.loading = true;
    try {
      const result = await this.importService.import(this.project.id, this.selectedLocale, this.selectedFormat, this.files[0]).toPromise();
      this.errorMessage = undefined;
      this.result = result.data;
      this.store.dispatch(new RefreshProjectStats());
    } catch (error) {
      console.error(error);
      this.errorMessage = errorToMessage(error, 'ImportLocale');
    }
    this.loading = false;
  }

  reset() {
    this.result = undefined;
    this.files = [];
    this.loading = false;
    this.isHovering = false;
    this.errorMessage = undefined;
    this.selectedFormat = undefined;
    this.selectedLocale = undefined;
  }

  canImport() {
    return !this.loading && this.hasExactlyOneFile() && this.selectedFormat && this.selectedLocale;
  }

  onSelectLocale(locale: Locale) {
    this.selectedLocale = locale;
  }

  selectedLocaleAlreadyExists() {
    return this.selectedLocale && this.projectLocales.find(l => l.code === this.selectedLocale.code);
  }

  hasExactlyOneFile() {
    return this.files && this.files.length === 1;
  }

  dropFiles(files: FileList) {
    const list: File[] = [];
    for (let i = 0; i < files.length; i++) {
      list.push(files.item(i));
    }
    this.files = list;
    this.guessAndSelectFormat();
  }

  guessAndSelectFormat() {
    const filenames = this.files.map(v => v.name);
    const extensions = filenames.map(filename => {
      const matches = filename.match(/.*\.([a-zA-Z0-9]*)$/);
      if (matches.length <= 1) {
        return undefined;
      }
      const extension = matches[1];
      return extension;
    });

    const mostFrequentExtension = _.head(_(extensions).countBy().entries().maxBy(_.last));

    if (mostFrequentExtension) {
      const format = IMPORT_FORMATS.find(v => v.extension === mostFrequentExtension);
      if (format) {
        this.selectedFormat = format;
      }
    }
  }

  removeFile(file: File) {
    this.files = this.files.filter(f => f !== file);
    this.guessAndSelectFormat();
  }

  setHover(event: boolean) {
    this.isHovering = event;
  }
}
