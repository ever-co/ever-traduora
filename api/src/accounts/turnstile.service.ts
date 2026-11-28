import { HttpStatus, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import axios from 'axios';
import { config } from '../config';
import { AccountException } from '../errors';

/** Cloudflare's limit for a Turnstile response token. */
const MAX_TOKEN_LENGTH = 2048;

/** How long the siteverify call may take before the check counts as unavailable, ms. */
const VERIFY_TIMEOUT_MS = 10_000;

/** Whether Turnstile is on: both keys set (DESIGN §3.8, OD-T8). Off when either is unset. */
export const turnstileEnabled = (): boolean => !!config.turnstile.siteKey && !!config.turnstile.secretKey;

/** The site key the web app renders the widget with, when Turnstile is on. */
export const turnstileSiteKey = (): string | undefined => (turnstileEnabled() ? config.turnstile.siteKey : undefined);

/**
 * Cloudflare Turnstile on sign-up and forgot-password. The web app renders the widget with the site key of
 * `GET /auth/providers` and sends its token; the server asks Cloudflare's siteverify whether it passed, with the secret
 * key, which never leaves the server. Off when the keys are unset: every request passes, as before.
 */
@Injectable()
export class TurnstileService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Turnstile');

  onApplicationBootstrap(): void {
    if (!!config.turnstile.siteKey !== !!config.turnstile.secretKey) {
      this.logger.warn('Only one of TR_TURNSTILE_SITE_KEY and TR_TURNSTILE_SECRET_KEY is set: the bot check stays off until both are');
    }
  }

  /**
   * Passes when Turnstile is off or Cloudflare confirms the token; otherwise 400 `turnstile_failed`, or 503
   * `turnstile_unavailable` when Cloudflare cannot be asked (the request is refused: it is not let through unchecked).
   */
  async assertHuman(token: unknown, remoteIp?: string): Promise<void> {
    if (!turnstileEnabled()) {
      return;
    }
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
      throw this.failed();
    }
    const form = new URLSearchParams({ secret: config.turnstile.secretKey, response: token });
    if (remoteIp) {
      form.set('remoteip', remoteIp);
    }
    let outcome: { success?: unknown; 'error-codes'?: unknown } | undefined;
    try {
      const response = await axios.post(config.turnstile.verifyUrl, form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: VERIFY_TIMEOUT_MS,
        // Cloudflare answers 200 with success false for a token that did not pass; anything else is read the same way
        validateStatus: () => true,
      });
      outcome = response.data;
    } catch (error) {
      this.logger.error(`siteverify unreachable: ${error?.code ?? error?.message ?? 'error'}`);
      throw new AccountException(HttpStatus.SERVICE_UNAVAILABLE, 'turnstile_unavailable', 'The bot check is unavailable, please try again');
    }
    if (outcome?.success !== true) {
      const codes = Array.isArray(outcome?.['error-codes']) ? (outcome['error-codes'] as unknown[]).join(',') : 'none';
      this.logger.warn(`siteverify refused the token: ${codes}`);
      throw this.failed();
    }
  }

  private failed(): AccountException {
    return new AccountException(HttpStatus.BAD_REQUEST, 'turnstile_failed', 'The bot check did not pass, please try again');
  }
}
