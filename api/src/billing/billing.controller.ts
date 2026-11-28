import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { config } from '../config';
import { DataSource } from 'typeorm';
import { Access } from '../access/access.decorator';
import { OrganizationException } from '../errors';
import { billingMembership } from '../services/organization/organization-billing';
import { assertSaasEnabled } from '../services/organization/organization.service';
import { BillingService } from './billing.service';
import { BillingRedirectResponse, BillingViewResponse, ChangeSubscriptionRequest, CheckoutRequest, SubscriptionChangeResponse } from './billing.dto';

/**
 * The billing of an organization (DESIGN §3.7, §5), SaaS mode only: the owner and the admins read it, only the owner
 * changes it (Checkout, the subscription, the customer portal). The default organization of an upgraded install is not
 * billed (404 `saas_disabled`, as its members routes).
 */
/**
 * Requests per organization, whoever sends them: every billing route reaches the shared Stripe account, which bills the
 * other Ever products too. Counted per route (the throttler's key names the handler).
 */
const perOrganization = (limit: number) =>
  Throttle({
    default: { limit, ttl: config.billing.throttle.ttl, getTracker: req => `billing:${req.params?.organizationId ?? ''}` },
  });

@Controller('api/v1/organizations/:organizationId/billing')
@ApiOAuth2([])
@ApiTags('Billing')
export default class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly dataSource: DataSource,
  ) {}

  @perOrganization(config.billing.throttle.reads)
  @Access('organization:ViewBilling')
  @Get()
  @ApiOperation({ summary: "The organization's plan, seats, trial and next invoice (owner, admin)" })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: BillingViewResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  async find(@Req() req, @Param('organizationId') organizationId: string) {
    const membership = await this.membership(req, organizationId);
    return { data: await this.billing.view(membership.organization, membership.role) };
  }

  @perOrganization(config.billing.throttle.changes)
  @Access('organization:ManageBilling')
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open a Stripe Checkout for a paid plan (owner)', description: 'The open session is handed out again until it expires.' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The Checkout page', type: BillingRedirectResponse })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The organization has a subscription (subscription_exists)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found, or billing is not set up (billing_disabled)' })
  async checkout(@Req() req, @Param('organizationId') organizationId: string, @Body() payload: CheckoutRequest) {
    const membership = await this.membership(req, organizationId);
    return { data: await this.billing.checkout(membership.organizationId, req.user, payload) };
  }

  @perOrganization(config.billing.throttle.changes)
  @Access('organization:ManageBilling')
  @Patch('subscription')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Change the subscription's plan, interval or extra seats (owner)",
    description: 'A raise is invoiced at once and applies once that invoice is paid: until then the answer says pending.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Changed, or pending the payment of its invoice', type: SubscriptionChangeResponse })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The organization has no subscription (no_subscription)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found, or billing is not set up (billing_disabled)' })
  async changeSubscription(@Req() req, @Param('organizationId') organizationId: string, @Body() payload: ChangeSubscriptionRequest) {
    const membership = await this.membership(req, organizationId);
    return { data: await this.billing.changeSubscription(membership.organizationId, payload) };
  }

  @perOrganization(config.billing.throttle.changes)
  @Access('organization:ManageBilling')
  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Open the Stripe customer portal: payment methods, invoices, cancellation (owner)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'The portal page', type: BillingRedirectResponse })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'No billing account yet (billing_account_missing)' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found, or billing is not set up (billing_disabled)' })
  async portal(@Req() req, @Param('organizationId') organizationId: string) {
    const membership = await this.membership(req, organizationId);
    return { data: await this.billing.portal(membership.organization) };
  }

  /**
   * The caller's membership, which the access guard checked already for the route's action; read again for the role and
   * the organization as they are now.
   */
  private async membership(req: { user?: { id?: string } }, organizationId: string) {
    assertSaasEnabled();
    const membership = await billingMembership(this.dataSource.manager, organizationId, req.user?.id);
    if (!membership?.organization) {
      throw new OrganizationException(HttpStatus.NOT_FOUND, 'organization_missing', 'organization not found');
    }
    if (membership.organization.isDefault) {
      throw new OrganizationException(HttpStatus.NOT_FOUND, 'saas_disabled', 'Organizations are not enabled on this installation');
    }
    return membership;
  }
}
