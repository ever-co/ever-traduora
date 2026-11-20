import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import {
  EverManagedOperation,
  EverManagedUpdate,
  EverManagedView,
  EverManagedWindow,
  EverPlatformService,
} from '../../services/ever-platform.service';

/** What an error code of the maintenance routes means to the operator. */
const ERRORS: Record<string, string> = {
  invalid_managed: 'This installation cannot use these settings.',
  BadRequest: 'These settings are not valid.',
  NotFound: 'Maintenance operations are not available on this installation.',
  Busy: 'Another change was saved at the same time. Nothing was changed; try again.',
};

const GENERIC_ERROR = 'That did not work. Please try again.';

/** The kinds of maintenance operations, as the operator reads them. */
const KINDS: Record<string, string> = {
  health_report: 'Health report',
  backup: 'Backup',
  restore_check: 'Backup check',
  update: 'Update',
};

/** Why an operation did not run or failed, as the operator reads it (other reasons are shown as they come). */
const REASONS: Record<string, string> = {
  operated_by_ever: 'Ever operates this installation',
  denied_by_policy: 'Denied on this server (TR_EVER_CONNECT_INTEGRATIONS_DENY)',
  no_consent: 'Your organization has not enabled maintenance operations',
  no_operator_opt_in: 'Not allowed here',
  kind_not_allowed: 'This kind is not allowed here',
  outside_window: 'Outside your windows',
  kind_not_supported: 'This installation does not run this kind',
  unsupported_dialect: 'Backups run on SQLite only',
  update_not_supported: 'Updates are never run from inside the container',
  no_backup_directory: 'No backup directory is set',
  backup_directory_unwritable: 'The backup directory cannot be written to',
  connection_ended: 'The connection ended before it ran',
  interrupted: 'Interrupted: the API stopped while it ran',
  request_unreadable: 'The request could not be read',
};

/** The days of a window, 0 = Sunday, as the API numbers them. */
export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The most windows the API takes. */
export const MAX_WINDOWS = 14;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** An absolute path on a Linux or Windows server (the API checks it again on its own platform). */
const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/]|\\\\)/;

/** A window as the form edits it: one switch per day. */
export interface WindowForm {
  days: boolean[];
  from: string;
  to: string;
}

/** The history rows shown before *Show all*. */
const HISTORY_SHOWN = 10;

/**
 * Ever Platform → Maintenance operations: the operator's opt-in to the health reports, backups and backup checks an
 * owner or admin of the organization can request from app.ever.co, the kinds allowed, the windows they may run in, the
 * backup directory (write-only), and the recent operations. Shown to the operator only, while the connection module is
 * loaded; hidden where Ever operates the installation (the API answers 404 there).
 */
@Component({
  standalone: false,
  selector: 'app-ever-platform-maintenance',
  templateUrl: './maintenance.component.html',
})
export class MaintenanceComponent implements OnInit {
  readonly dayNames = DAYS;
  readonly maxWindows = MAX_WINDOWS;
  view: EverManagedView | null = null;
  optIn = false;
  kinds: Record<string, boolean> = {};
  windows: WindowForm[] = [];
  /** A new backup directory (never filled with the current one, which the API does not show). */
  backupDir = '';
  removeBackupDir = false;
  showAllHistory = false;
  busy = false;
  message: string | null = null;
  errorMessage: string | null = null;
  /** Answers of reads started before the last change are dropped. */
  private generation = 0;
  /** The settings as last read or saved, to tell whether the form changed them. */
  private saved = '';

  constructor(private everPlatform: EverPlatformService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    const generation = ++this.generation;
    this.errorMessage = null;
    this.everPlatform.managed().subscribe({
      next: view => {
        if (generation === this.generation) this.show(view);
      },
      error: error => {
        if (generation !== this.generation) return;
        if (error instanceof HttpErrorResponse && error.status === 404) {
          // Not this installation's (Ever operates it), or the module went away: nothing to show
          this.view = null;
          return;
        }
        this.fail(error);
      },
    });
  }

  addWindow(): void {
    if (this.windows.length < MAX_WINDOWS) {
      this.windows.push({ days: DAYS.map(() => false), from: '02:00', to: '04:00' });
    }
  }

  removeWindow(index: number): void {
    this.windows.splice(index, 1);
  }

  /** What is wrong with a window, or `null` when the API takes it. */
  windowError(window: WindowForm): string | null {
    if (!window.days.some(Boolean)) return 'Choose at least one day.';
    if (!HHMM.test(window.from || '') || !HHMM.test(window.to || '')) return 'Enter a start and an end time (HH:MM, UTC).';
    if (window.from === window.to) return 'The start and the end time must differ.';
    return null;
  }

  /** What is wrong with the new backup directory, or `null` (empty keeps the current one). */
  get backupDirError(): string | null {
    const dir = this.backupDir.trim();
    if (!dir || this.removeBackupDir) return null;
    if (dir.length > 1024) return 'At most 1024 characters.';
    if (!ABSOLUTE_PATH.test(dir)) return 'Enter an absolute path on the server, such as /app/api/backups.';
    return null;
  }

  get valid(): boolean {
    return this.windows.every(window => !this.windowError(window)) && !this.backupDirError;
  }

  get changed(): boolean {
    return this.serialize() !== this.saved || !!this.backupDir.trim() || this.removeBackupDir;
  }

  /** Why nothing would run with these settings, while opted in (saving is still allowed). */
  get warning(): string | null {
    if (!this.optIn || !this.view) return null;
    if (!this.view.supportedKinds.some(kind => this.kinds[kind])) return 'No kind is allowed: nothing will run.';
    if (!this.windows.length) return 'There is no window: nothing will run.';
    return null;
  }

  get shownHistory(): EverManagedOperation[] {
    const history = this.view ? this.view.history : [];
    return this.showAllHistory ? history : history.slice(0, HISTORY_SHOWN);
  }

  kindLabel(kind: string): string {
    return KINDS[kind] || kind;
  }

  reasonLabel(reason: string | null): string {
    return reason ? REASONS[reason] || reason.replace(/_/g, ' ') : '';
  }

  /** Why it did not run, or the size of a backup. */
  detail(operation: EverManagedOperation): string {
    return [this.reasonLabel(operation.reason), this.size(operation.sizeBytes)].filter(Boolean).join(', ');
  }

  /** A size in bytes, as people read it. */
  size(bytes: number | null): string {
    if (bytes === null || bytes === undefined) return '';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
  }

  save(): void {
    if (this.busy || !this.valid) return;
    const update: EverManagedUpdate = this.request();
    if (this.removeBackupDir) {
      update.backupDir = '';
    } else if (this.backupDir.trim()) {
      update.backupDir = this.backupDir.trim();
    }
    this.generation++;
    this.message = null;
    this.errorMessage = null;
    this.busy = true;
    this.everPlatform.updateManaged(update).subscribe({
      next: view => {
        this.busy = false;
        this.show(view);
        this.message = 'Saved.';
      },
      error: error => this.fail(error),
    });
  }

  /** The opt-in, kinds and windows the form holds, as the API takes them. */
  private request(): EverManagedUpdate {
    const supported = this.view ? this.view.supportedKinds : [];
    return {
      optIn: this.optIn,
      kinds: supported.filter(kind => this.kinds[kind]),
      windows: this.windows.map(window => ({
        days: window.days.map((on, day) => (on ? day : -1)).filter(day => day >= 0),
        from: window.from,
        to: window.to,
      })),
    };
  }

  private serialize(): string {
    return JSON.stringify(this.request());
  }

  private show(view: EverManagedView): void {
    this.view = view;
    this.optIn = view.optIn;
    this.kinds = {};
    for (const kind of view.supportedKinds) {
      this.kinds[kind] = view.kinds.includes(kind);
    }
    this.windows = view.windows.map((window: EverManagedWindow) => ({
      days: DAYS.map((_, day) => window.days.includes(day)),
      from: window.from,
      to: window.to,
    }));
    this.backupDir = '';
    this.removeBackupDir = false;
    this.saved = this.serialize();
  }

  private fail(error: unknown): void {
    this.busy = false;
    const body = error instanceof HttpErrorResponse && error.error && error.error.error ? error.error.error : undefined;
    const known = body && typeof body.code === 'string' ? ERRORS[body.code] : undefined;
    // The API says which value it cannot use (a kind, a window or the directory)
    const detail = body && body.code === 'invalid_managed' && typeof body.message === 'string' ? ` ${body.message}.` : '';
    this.errorMessage = known ? `${known}${detail}` : GENERIC_ERROR;
  }
}
