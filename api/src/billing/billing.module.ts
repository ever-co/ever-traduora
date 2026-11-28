import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '../config';
import { BillingEvent } from '../entity/billing-event.entity';
import BillingController from './billing.controller';
import { BillingService } from './billing.service';
import BillingWebhookController from './billing-webhook.controller';
import { STRIPE_CLIENT, stripeClientFor } from './stripe-client';
import { BillingThrottleGuard } from './billing-throttle.guard';

/**
 * Stripe Billing of the organizations (DESIGN §3.7, P4). Always loaded, and off in two ways:
 * - outside SaaS mode, no Stripe client is made at all (a key a single-tenant install happens to carry, malformed or
 *   live, never stops it from starting); the organization billing routes answer 404 `saas_disabled`, the webhook 404
 *   `billing_disabled`;
 * - in SaaS mode without `TR_STRIPE_SECRET_KEY`, the billing page still answers (200, `enabled: false`), while Checkout,
 *   changes, the portal and the webhook answer 404 `billing_disabled`.
 * Nothing is sent to Stripe in either. The webhook's raw body is mounted by `addPipesAndFilters`
 * (`mountBillingWebhookBody`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([BillingEvent])],
  controllers: [BillingController, BillingWebhookController],
  providers: [{ provide: STRIPE_CLIENT, useFactory: () => stripeClientFor(config) }, BillingService, BillingThrottleGuard],
  exports: [BillingService],
})
export class BillingModule {}
