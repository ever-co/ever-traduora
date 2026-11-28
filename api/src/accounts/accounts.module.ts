import { Injectable, Module, OnApplicationBootstrap } from '@nestjs/common';
import { config } from '../config';
import { currentLegalDocuments } from './legal-documents';
import { TurnstileService } from './turnstile.service';

/**
 * Refuses to start in SaaS mode when no version is known for the terms or the privacy policy: sign-ups would have
 * nothing to accept and every account would wait for an acceptance it cannot give.
 */
@Injectable()
export class LegalDocumentsBootCheck implements OnApplicationBootstrap {
  onApplicationBootstrap(): void {
    if (config.saasEnabled && !currentLegalDocuments()) {
      throw new Error(
        'SaaS mode needs the versions of the terms of service and the privacy policy: install @ever-co/legal, or set TR_TERMS_VERSION and TR_PRIVACY_VERSION',
      );
    }
  }
}

/** Accounts and hardening (DESIGN §3.8): the bot check and the legal documents' boot check. */
@Module({
  providers: [TurnstileService, LegalDocumentsBootCheck],
  exports: [TurnstileService],
})
export class AccountsModule {}
