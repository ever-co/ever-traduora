import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { saveAs } from 'file-saver';
import { EverPersonExport, EverPlatformService } from '../../../ever-platform/services/ever-platform.service';

/** The name of a downloaded export: the day it was made and its id (letters, digits, `-` and `_` only). */
export function exportFileName(row: EverPersonExport): string {
  const day = new Date(row.createdAt).toISOString().slice(0, 10);
  return `traduora-export-${day}-${row.jobId.replace(/[^0-9A-Za-z_-]/g, '')}.json`;
}

/**
 * Account settings → My data exports: the exports of the signed-in user's own account, made for an export request the
 * user sent from app.ever.co, each downloadable as a JSON file for 7 days. Hidden while the Ever Platform connection
 * module is not loaded: its routes do not exist then, so the list answers 404.
 */
@Component({
  standalone: false,
  selector: 'app-my-data-exports',
  templateUrl: './my-data-exports.component.html',
})
export class MyDataExportsComponent implements OnInit {
  /** `null` until the list is read, and while the module is not loaded. */
  exports: EverPersonExport[] | null = null;
  loadFailed = false;
  /** The export being downloaded. */
  downloading: string | null = null;
  errorMessage: string | null = null;

  constructor(private everPlatform: EverPlatformService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.loadFailed = false;
    this.everPlatform.myExports().subscribe({
      next: rows => (this.exports = rows),
      error: error => {
        // 404: the connection module is not loaded. 0: no answer at all, which says nothing about the module either
        if (error instanceof HttpErrorResponse && (error.status === 404 || error.status === 0)) {
          this.exports = null;
          return;
        }
        this.loadFailed = true;
      },
    });
  }

  download(row: EverPersonExport): void {
    if (this.downloading) return;
    this.errorMessage = null;
    this.downloading = row.jobId;
    this.everPlatform.myExport(row.jobId).subscribe({
      next: bundle => {
        this.downloading = null;
        this.save(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }), exportFileName(row));
      },
      error: error => {
        this.downloading = null;
        if (error instanceof HttpErrorResponse && error.status === 404) {
          // Expired meanwhile (or no longer readable): it is gone from the list too
          this.errorMessage = 'This export is no longer available.';
          this.exports = (this.exports || []).filter(other => other.jobId !== row.jobId);
          return;
        }
        this.errorMessage = 'The export could not be downloaded. Please try again.';
      },
    });
  }

  /** Hands the file to the browser (replaced in tests). */
  save(blob: Blob, name: string): void {
    saveAs(blob, name);
  }
}
