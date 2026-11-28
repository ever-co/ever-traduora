import { Injectable, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { config } from '../config';
import { currentLegalDocuments } from './legal-documents';
import { TurnstileService } from './turnstile.service';
import { AttemptLimiter } from './attempt-limiter';

/**
 * SaaS mode at boot:
 * - refuses to start when no version is known for the terms or the privacy policy: sign-ups would have nothing to
 *   accept and every account would wait for an acceptance it cannot give;
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
    if (!currentLegalDocuments()) {
      throw new Error(
        'SaaS mode needs the versions of the terms of service and the privacy policy: install @ever-co/legal, or set TR_TERMS_VERSION and TR_PRIVACY_VERSION',
      );
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
