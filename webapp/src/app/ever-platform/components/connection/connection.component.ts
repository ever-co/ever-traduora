import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { EverConnectAuditRow, EverConnectIntegration, EverConnectStatus, EverPlatformService } from '../../services/ever-platform.service';

/** What an error code of the connection routes means to the operator. */
const ERRORS: Record<string, string> = {
  code_invalid: 'This connect code is not valid. Create a new one in app.ever.co.',
  already_connected: 'This installation is already connected.',
  not_connected: 'This installation is not connected.',
  secret_missing: 'Set TR_SECRET on the server first: the connection key is stored encrypted with it.',
  no_destination: 'The Ever Platform address of this server cannot be used.',
  platform_unavailable: 'Ever Platform could not be reached. Nothing was changed; try again later.',
  consent_required: 'An owner or admin of your organization must first enable the installation address in app.ever.co.',
  denied_by_policy: 'This integration is denied on this server (TR_EVER_CONNECT_INTEGRATIONS_DENY).',
  url_invalid: 'Enter an absolute https address, without a query or a fragment.',
  nothing_to_accept: 'This integration does not wait for your answer.',
};

const GENERIC_ERROR = 'That did not work. Please try again.';

/**
 * Ever Platform → Connection: connect this installation to an organization with a code from app.ever.co, see the
 * integrations an owner or admin consented to (and what each one moves), switch them off, and disconnect.
 */
@Component({
  standalone: false,
  selector: 'app-ever-platform-connection',
  templateUrl: './connection.component.html',
})
export class ConnectionComponent implements OnInit {
  status: EverConnectStatus | null = null;
  integrations: EverConnectIntegration[] = [];
  audit: EverConnectAuditRow[] = [];
  code = '';
  displayName = 'Traduora';
  publicUrl = '';
  busy = false;
  confirmingDisconnect = false;
  shownScope: string | null = null;
  message: string | null = null;
  errorMessage: string | null = null;
  /** The app.ever.co address the operator opens to consent (a plain link: no window is opened for them). */
  consentLink: { key: string; url: string } | null = null;
  /** Answers of reads started before the last change are dropped. */
  private generation = 0;

  constructor(private everPlatform: EverPlatformService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    const generation = ++this.generation;
    const current = () => generation === this.generation;
    this.everPlatform.status().subscribe({
      next: status => {
        if (!current()) return;
        this.status = status;
        if (status.connected) {
          this.everPlatform.integrations().subscribe({
            next: integrations => {
              if (current()) this.integrations = integrations;
            },
            error: () => {
              if (current()) this.integrations = [];
            },
          });
        } else {
          this.integrations = [];
        }
      },
      error: error => {
        if (current()) this.fail(error);
      },
    });
    this.everPlatform.audit().subscribe({
      next: rows => {
        if (current()) this.audit = rows;
      },
      error: () => {
        if (current()) this.audit = [];
      },
    });
  }

  connect(): void {
    this.generation++;
    this.clearMessages();
    this.busy = true;
    this.everPlatform.connect(this.code.trim(), this.displayName.trim()).subscribe({
      next: status => {
        this.busy = false;
        this.code = '';
        this.status = status;
        this.message =
          status.status === 'pending_approval' ? 'Connected: an owner or admin of your organization must approve it in app.ever.co.' : 'Connected.';
        this.refresh();
      },
      error: error => this.fail(error),
    });
  }

  disconnect(): void {
    this.generation++;
    this.clearMessages();
    this.busy = true;
    this.everPlatform.disconnect().subscribe({
      next: () => {
        this.busy = false;
        this.confirmingDisconnect = false;
        this.message = 'Disconnected. Nothing is sent to Ever Platform any more.';
        this.refresh();
      },
      error: error => this.fail(error),
    });
  }

  /** Check again: the integrations from Ever Platform, then the connection and its changes. */
  refreshIntegrations(): void {
    this.generation++;
    this.clearMessages();
    this.busy = true;
    this.everPlatform.refreshIntegrations().subscribe({
      next: integrations => {
        this.busy = false;
        this.integrations = integrations;
        this.refresh();
      },
      error: error => this.fail(error),
    });
  }

  /** Opens app.ever.co, where an owner or admin of the organization consents; nothing is enabled here. */
  enable(key: string): void {
    this.clearMessages();
    this.consentLink = null;
    this.everPlatform.consentUrl(key).subscribe({
      next: url => (this.consentLink = { key, url }),
      error: error => this.fail(error),
    });
  }

  accept(key: string, accepted: boolean): void {
    this.run(this.everPlatform.accept(key, accepted), accepted ? 'Accepted.' : 'Declined.');
  }

  disable(key: string): void {
    this.run(this.everPlatform.disable(key), 'Switched off.');
  }

  setPublicUrl(): void {
    this.run(this.everPlatform.setPublicUrl(this.publicUrl.trim()), 'The address was sent to Ever Platform.');
  }

  clearPublicUrl(): void {
    this.run(this.everPlatform.clearPublicUrl(), 'The address was removed from Ever Platform.');
  }

  toggleScope(key: string): void {
    this.shownScope = this.shownScope === key ? null : key;
  }

  private run(call: ReturnType<EverPlatformService['disable']>, done: string): void {
    this.generation++;
    this.clearMessages();
    this.busy = true;
    call.subscribe({
      next: integrations => {
        this.busy = false;
        this.integrations = integrations;
        this.message = done;
        this.everPlatform.audit().subscribe({ next: rows => (this.audit = rows), error: () => undefined });
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
