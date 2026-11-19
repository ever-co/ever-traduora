import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { EverStatsPreview, EverStatsReport, EverStatsService, EverStatsStatus } from '../../services/ever-stats.service';

/** What an error code of the statistics routes means to the operator. */
const ERRORS: Record<string, string> = {
  stats_disabled: 'Anonymous usage statistics are turned off: nothing was sent.',
  rate_limited: 'Send now can be used once every 10 minutes.',
  cloud_managed: 'This installation is managed by its deployment: this switch cannot be changed here.',
  no_destination: 'The statistics address of this server cannot be used: nothing was sent.',
  busy: 'Another report is being sent right now. Try again in a few minutes.',
  refused_until_upgrade: 'Ever Platform does not accept the reports of this version: nothing is sent until Traduora is upgraded.',
  secret_missing: 'TR_SECRET is not set on the server: the statistics key cannot be stored, so nothing can be done here.',
  key_unreadable: 'The statistics key of this installation cannot be read.',
};

const GENERIC_ERROR = 'That did not work. Please try again.';

/**
 * Ever Platform → Statistics: what this installation sends, the switch, *Send now* and *Reset instance identity*. Shown
 * to the operator of the installation only (the API answers nobody else).
 */
@Component({
  standalone: false,
  selector: 'app-ever-platform-statistics',
  templateUrl: './statistics.component.html',
})
export class StatisticsComponent implements OnInit {
  status: EverStatsStatus | null = null;
  reports: EverStatsReport[] = [];
  preview: EverStatsPreview | null = null;
  unavailable = false;
  busy = false;
  confirmingReset = false;
  message: string | null = null;
  errorMessage: string | null = null;

  constructor(private everStats: EverStatsService) {}

  ngOnInit(): void {
    this.refresh();
  }

  get lastReport(): EverStatsReport | null {
    return this.reports.length ? this.reports[0] : null;
  }

  /** The report that would be sent now, indented for reading (the last payload is shown as its exact bytes). */
  pretty(payload: Record<string, unknown>): string {
    return JSON.stringify(payload, null, 2);
  }

  refresh(): void {
    this.everStats.status().subscribe({
      next: status => {
        this.status = status;
        this.unavailable = false;
      },
      error: () => {
        this.status = null;
        this.unavailable = true;
      },
    });
    this.everStats.reports().subscribe({
      next: reports => (this.reports = reports),
      error: () => (this.reports = []),
    });
  }

  showPreview(): void {
    this.clearMessages();
    this.everStats.preview().subscribe({
      next: preview => (this.preview = preview),
      error: error => this.fail(error),
    });
  }

  toggle(enabled: boolean): void {
    this.clearMessages();
    this.busy = true;
    this.everStats.setEnabled(enabled).subscribe({
      next: () => {
        this.busy = false;
        this.message = enabled ? 'Anonymous usage statistics are on.' : 'Anonymous usage statistics are off: nothing is sent.';
        this.refresh();
      },
      error: error => this.fail(error),
    });
  }

  sendNow(): void {
    this.clearMessages();
    this.busy = true;
    this.everStats.sendNow().subscribe({
      next: () => {
        this.busy = false;
        this.message = 'Done: see the last payload below.';
        this.refresh();
      },
      error: error => this.fail(error),
    });
  }

  resetIdentity(): void {
    this.clearMessages();
    this.busy = true;
    this.everStats.resetIdentity().subscribe({
      next: () => {
        this.busy = false;
        this.confirmingReset = false;
        this.preview = null;
        this.message = 'The instance identity was reset.';
        this.refresh();
      },
      error: error => this.fail(error),
    });
  }

  private clearMessages(): void {
    this.message = null;
    this.errorMessage = null;
  }

  private fail(error: unknown): void {
    this.busy = false;
    const code = error instanceof HttpErrorResponse && error.error && error.error.error ? error.error.error.code : undefined;
    this.errorMessage = (code && ERRORS[code]) || GENERIC_ERROR;
  }
}
