import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { config } from '../config';
import { BillingEvent } from '../entity/billing-event.entity';
import BillingController from './billing.controller';
import { BillingService } from './billing.service';
import BillingWebhookController from './billing-webhook.controller';
import { createStripeClient, STRIPE_CLIENT } from './stripe-client';

/**
 * Stripe Billing of the organizations (DESIGN §3.7, P4). Always loaded: without `TR_STRIPE_SECRET_KEY`, or outside SaaS
 * mode, its routes answer 404 `billing_disabled` and nothing is sent to Stripe. The webhook's raw body is mounted by
 * `addPipesAndFilters` (`mountBillingWebhookBody`).
 */
@Module({
  imports: [TypeOrmModule.forFeature([BillingEvent])],
  controllers: [BillingController, BillingWebhookController],
  providers: [{ provide: STRIPE_CLIENT, useFactory: () => createStripeClient(config.billing) }, BillingService],
  exports: [BillingService],
})
export class BillingModule {}
