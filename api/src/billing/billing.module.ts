import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '../config';
import { BillingEvent } from '../entity/billing-event.entity';
import BillingController from './billing.controller';
import { BillingService } from './billing.service';
import BillingWebhookController from './billing-webhook.controller';
import { STRIPE_CLIENT, stripeClientFor } from './stripe-client';

/**
 * Stripe Billing of the organizations (DESIGN §3.7, P4). Always loaded: without `TR_STRIPE_SECRET_KEY`, or outside SaaS
 * mode, its routes answer 404 `billing_disabled` and nothing is sent to Stripe. Outside SaaS mode no Stripe client is
 * made at all, so a key a single-tenant install happens to carry (malformed, or live) never stops it from starting. The
 * webhook's raw body is mounted by `addPipesAndFilters` (`mountBillingWebhookBody`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([BillingEvent])],
  controllers: [BillingController, BillingWebhookController],
  providers: [{ provide: STRIPE_CLIENT, useFactory: () => stripeClientFor(config) }, BillingService],
  exports: [BillingService],
})
export class BillingModule {}
