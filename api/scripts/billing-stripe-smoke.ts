/**
 * A smoke run of billing against Stripe in TEST mode (DESIGN §3.7, §10): the prices by lookup key, a customer, Checkout
 * sessions built exactly as the API builds them (Small Business with extra seats, Small Business with the seat price
 * offered, Enterprise), their line items, and a customer portal session. It prints ids, statuses and quantities only,
 * never a key or a page URL, and expires the sessions it opened.
 *
 *   TR_STRIPE_SECRET_KEY=sk_test_… npx ts-node scripts/billing-stripe-smoke.ts
 *
 * It refuses any key that is not a test-mode key.
 */
import { randomUUID } from 'crypto';
import { BillingInterval, planLookupKey, seatLookupKey } from '../src/billing/billing-plans';
import { checkoutSessionParams } from '../src/billing/billing.service';
import { createStripeClient, isTestModeKey } from '../src/billing/stripe-client';
import { OrganizationPlanCode } from '../src/domain/organization-actions';

async function main() {
  const key = (process.env.TR_STRIPE_SECRET_KEY || '').trim();
  if (!key.startsWith('sk_test_') && !key.startsWith('rk_test_')) {
    throw new Error('Refusing: TR_STRIPE_SECRET_KEY must be a test-mode key (sk_test_… or rk_test_…).');
  }
  if (!isTestModeKey(key)) {
    throw new Error('Refusing: not a test-mode key.');
  }
  const stripe = createStripeClient({ stripeSecretKey: key, stripeLiveMode: false });
  const run = randomUUID();
  const organization = { id: run, slug: 'smoke-test' };
  const out = (label: string, fields: Record<string, unknown>) => console.log(`${label.padEnd(34)} ${JSON.stringify(fields)}`);

  // 1. The prices, by lookup key
  const keys = Object.values(BillingInterval).flatMap(interval => [
    planLookupKey(OrganizationPlanCode.SmallBusiness, interval),
    planLookupKey(OrganizationPlanCode.Enterprise, interval),
    seatLookupKey(interval),
  ]);
  const prices = new Map((await stripe.prices.list({ lookup_keys: keys, active: true, limit: 10 })).data.map(price => [price.lookup_key, price]));
  for (const lookupKey of keys) {
    const price = prices.get(lookupKey);
    out(`price ${lookupKey}`, price ? { id: price.id, livemode: price.livemode, amount: price.unit_amount, interval: price.recurring?.interval } : { missing: true });
  }
  const priceOf = (lookupKey: string) => {
    const price = prices.get(lookupKey);
    if (!price) {
      throw new Error(`Price ${lookupKey} is missing in test mode`);
    }
    return price;
  };

  // 2. A customer of a made-up organization, as the first Checkout makes it
  const customer = await stripe.customers.create(
    { name: 'Traduora billing smoke test', metadata: { organizationId: run, ever_product: 'traduora', smoke_test: 'true' } },
    { idempotencyKey: `traduora-smoke-customer-${run}` },
  );
  out('customer', { id: customer.id, livemode: customer.livemode });

  // 3. Checkout sessions, built by the API's own function
  const orders = [
    { label: 'checkout small_business monthly +3', plan: OrganizationPlanCode.SmallBusiness, interval: BillingInterval.Monthly, extraSeats: 3, trial: 90 },
    { label: 'checkout small_business annual +0', plan: OrganizationPlanCode.SmallBusiness, interval: BillingInterval.Annual, extraSeats: 0, trial: 90 },
    { label: 'checkout enterprise monthly', plan: OrganizationPlanCode.Enterprise, interval: BillingInterval.Monthly, extraSeats: 0, trial: 0 },
  ];
  const opened: string[] = [];
  for (const order of orders) {
    const seat = order.plan === OrganizationPlanCode.SmallBusiness ? priceOf(seatLookupKey(order.interval)) : null;
    const params = checkoutSessionParams(
      organization,
      customer.id,
      { plan: priceOf(planLookupKey(order.plan, order.interval)), seat },
      { plan: order.plan, interval: order.interval, extraSeats: order.extraSeats },
      order.trial,
      true,
    );
    const session = await stripe.checkout.sessions.create(params, { idempotencyKey: `traduora-smoke-${run}-${order.label.replace(/\W+/g, '-')}` });
    opened.push(session.id);
    const items = await stripe.checkout.sessions.listLineItems(session.id, { limit: 10 });
    out(order.label, {
      id: session.id,
      status: session.status,
      mode: session.mode,
      livemode: session.livemode,
      hasUrl: !!session.url,
      automaticTax: session.automatic_tax?.enabled,
      lineItems: items.data.map(item => `${item.price?.lookup_key} x${item.quantity}`),
      // Stripe accepts the optional seat item, but does not echo optional items back in this API version
      seatOffered: !!params.optional_items?.length,
    });
  }

  // 4. The customer portal on that customer
  const portal = await stripe.billingPortal.sessions.create({ customer: customer.id, return_url: 'https://app-dev.traduora.co/orgs/smoke-test/billing' });
  out('portal session', { id: portal.id, livemode: portal.livemode, hasUrl: !!portal.url });

  // 5. Nothing stays open
  for (const id of opened) {
    const expired = await stripe.checkout.sessions.expire(id);
    out('expired', { id: expired.id, status: expired.status });
  }
}

main().catch(error => {
  // The error of Stripe, without the request's headers
  console.error('smoke run failed:', error?.type ?? '', error?.code ?? '', error?.param ?? '', error?.message ?? error);
  process.exit(1);
});
