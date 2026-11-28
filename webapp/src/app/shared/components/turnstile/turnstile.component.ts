import { NgIf } from '@angular/common';
import { AfterViewInit, Component, ElementRef, EventEmitter, Injectable, Input, NgZone, OnDestroy, Output, ViewChild } from '@angular/core';

/** The part of Cloudflare's `window.turnstile` this app uses (explicit rendering). */
export interface TurnstileApi {
  render(
    element: HTMLElement,
    options: {
      sitekey: string;
      action?: string;
      theme?: 'light' | 'dark' | 'auto';
      size?: 'normal' | 'flexible' | 'compact';
      callback: (token: string) => void;
      'expired-callback': () => void;
      'error-callback': () => void;
    },
  ): string | undefined;
  reset(widgetId?: string): void;
  remove(widgetId?: string): void;
}

/** Cloudflare's script, rendered by hand (the CSP of the API allows challenges.cloudflare.com for it). */
export const TURNSTILE_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Loads Cloudflare's Turnstile script once per page. */
@Injectable({ providedIn: 'root' })
export class TurnstileLoader {
  private loading: Promise<TurnstileApi> | undefined;

  load(): Promise<TurnstileApi> {
    const ready = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (ready) {
      return Promise.resolve(ready);
    }
    if (!this.loading) {
      this.loading = new Promise<TurnstileApi>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = TURNSTILE_SCRIPT;
        script.async = true;
        script.onload = () => {
          const api = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
          if (api) {
            resolve(api);
          } else {
            reject(new Error('turnstile unavailable'));
          }
        };
        script.onerror = () => {
          // The next form asks again
          this.loading = undefined;
          script.remove();
          reject(new Error('turnstile unavailable'));
        };
        document.head.appendChild(script);
      });
    }
    return this.loading;
  }
}

/**
 * The Cloudflare Turnstile check of a form (sign-up, forgot-password), shown when the installation has a site key. It
 * emits the token once the check passes, and `undefined` when it expires or fails. A token is good for one request:
 * call `reset()` after a refused submit.
 */
@Component({
  selector: 'app-turnstile',
  template: `
    <div #slot class="turnstile-slot"></div>
    <p *ngIf="unavailable" class="text-sm text-muted mb-0">The bot check could not load. Reload the page to try again</p>
  `,
  styles: [
    `
      .turnstile-slot {
        min-height: 68px;
      }
    `,
  ],
  imports: [NgIf],
})
export class TurnstileComponent implements AfterViewInit, OnDestroy {
  @Input({ required: true }) siteKey!: string;
  /** What the check is for, recorded by Cloudflare with the token */
  @Input() action?: string;
  @Output() readonly token = new EventEmitter<string | undefined>();

  @ViewChild('slot', { static: true }) private slot!: ElementRef<HTMLElement>;

  unavailable = false;
  private api: TurnstileApi | undefined;
  private widgetId: string | undefined;
  private destroyed = false;

  constructor(
    private readonly loader: TurnstileLoader,
    private readonly zone: NgZone,
  ) {}

  async ngAfterViewInit(): Promise<void> {
    try {
      this.api = await this.loader.load();
    } catch {
      this.unavailable = true;
      return;
    }
    if (this.destroyed) {
      return;
    }
    const emit = (token: string | undefined) => this.zone.run(() => this.token.emit(token));
    this.widgetId = this.api.render(this.slot.nativeElement, {
      sitekey: this.siteKey,
      action: this.action,
      theme: 'light',
      size: 'flexible',
      callback: token => emit(token),
      'expired-callback': () => emit(undefined),
      'error-callback': () => emit(undefined),
    });
  }

  /** A fresh check, after a submit used the token. */
  reset(): void {
    this.token.emit(undefined);
    this.api?.reset(this.widgetId);
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.widgetId !== undefined) {
      this.api?.remove(this.widgetId);
    }
  }
}
