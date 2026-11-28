import { Controller, Headers, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Access } from '../access/access.decorator';
import { BillingService } from './billing.service';
import { BILLING_WEBHOOK_PATH } from './billing-webhook-body';

/**
 * Stripe's webhook (DESIGN §3.7): the raw body (`mountBillingWebhookBody`) is verified with `TR_STRIPE_WEBHOOK_SECRET`
 * before anything is read from it, so the route needs no caller.
 */
@Controller()
export default class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Access('webhook')
  @Post(BILLING_WEBHOOK_PATH)
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async receive(@Req() req: { body?: unknown }, @Headers('stripe-signature') signature: string | undefined) {
    const body = Buffer.isBuffer(req.body) || typeof req.body === 'string' ? req.body : undefined;
    await this.billing.handleWebhook(body, signature);
    return { received: true };
  }
}
