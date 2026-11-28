import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { config } from '../config';
import { currentLegalDocuments, LEGAL_VERSION_MAX_LENGTH } from './legal-documents';
import { TurnstileService } from './turnstile.service';
import { AttemptLimiter } from './attempt-limiter';

/**
 * SaaS mode at boot:
 * - refuses to start when no version is known for the terms or the privacy policy, or one is longer than the 64
 *   characters a sign-up may send back: sign-ups would have nothing they can accept and every account would wait for
 *   an acceptance it cannot give;
 * - logs an error, without refusing, when TR_TRUST_PROXY is unset: behind a proxy every visitor then shares the
 *   proxy's address, so one bucket of the rate limits and of the sign-up limit serves everyone.
 */
@Injectable()
export class AccountsBootCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger('AccountsBootCheck');

  onApplicationBootstrap(): void {
    if (!config.saasEnabled) {
      return;
    }
    const legal = currentLegalDocuments();
    if (!legal) {
      throw new Error(
        'SaaS mode needs the versions of the terms of service and the privacy policy: install @ever-co/legal, or set TR_TERMS_VERSION and TR_PRIVACY_VERSION',
      );
    }
    // A sign-up sends the version back, and the API takes at most 64 characters (as the user's columns hold)
    for (const [name, version] of [
      ['TR_TERMS_VERSION', legal.terms.version],
      ['TR_PRIVACY_VERSION', legal.privacy.version],
    ]) {
      if (version.length > LEGAL_VERSION_MAX_LENGTH) {
        throw new Error(`${name} is longer than ${LEGAL_VERSION_MAX_LENGTH} characters: no sign-up could accept it`);
      }
    }
    if (config.http.trustProxy === undefined) {
      this.logger.error(
        'TR_TRUST_PROXY is not set: behind a proxy or ingress every visitor shares its address, and so the rate limits. Set the hop count (e.g. 1)',
      );
    }
  }
}

/** Accounts and hardening (DESIGN §3.8): the bot check, the attempt limits and the legal documents' boot check. */
@Module({
  providers: [TurnstileService, AccountsBootCheck, AttemptLimiter],
  exports: [TurnstileService, AttemptLimiter],
})
export class AccountsModule {}
