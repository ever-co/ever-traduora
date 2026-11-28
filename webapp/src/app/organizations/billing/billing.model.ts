export type PaidPlan = 'small_business' | 'enterprise';
export type BillingInterval = 'monthly' | 'annual';

/** One plan on sale, with Stripe's price for an interval (cents) and the price of one extra seat */
export interface BillingOffer {
  plan: PaidPlan;
  interval: BillingInterval;
  amount: number;
  currency: string;
  seatAmount: number | null;
}

/**
 * The billing of an organization (`GET /organizations/:id/billing`, owner and admins). `plan` is the one whose limits
 * apply now (Starter once a subscription lapsed), `subscribedPlan` the one the subscription buys.
 */
export interface OrganizationBilling {
  enabled: boolean;
  plan: { code: string; name: string };
  subscribedPlan: { code: string; name: string };
  status: string | null;
  interval: BillingInterval | null;
  seats: { used: number; included: number | null; bought: number; limit: number | null };
  trialEndsAt: string | null;
  pastDueSince: string | null;
  graceEndsAt: string | null;
  nextInvoice: { date: string | null; amount: number | null; currency: string | null } | null;
  offers: BillingOffer[];
  trialAvailable: boolean;
  trialDays: number;
  canManage: boolean;
  subscribed: boolean;
  portalAvailable: boolean;
}

/** What a Checkout or a change of the subscription asks for */
export interface BillingOrder {
  plan: PaidPlan;
  interval: BillingInterval;
  extraSeats: number;
}

/** The plans on sale, as the API's plan table has them (DESIGN §3.6) */
export const PAID_PLANS: ReadonlyArray<{ code: PaidPlan; name: string; summary: string; sellsSeats: boolean }> = [
  { code: 'small_business', name: 'Small Business', summary: '25 seats, unlimited strings', sellsSeats: true },
  { code: 'enterprise', name: 'Enterprise', summary: 'Unlimited seats and strings', sellsSeats: false },
];

export const MAX_EXTRA_SEATS = 1000;

const dates = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "26 Feb 2027" */
export function billingDate(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : dates.format(date);
}

/** "$49.00", from cents and Stripe's currency code */
export function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (typeof amount !== 'number' || !currency) {
    return '';
  }
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(amount / 100);
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function per(interval: BillingInterval | null | undefined): string {
  return interval === 'annual' ? 'a year' : 'a month';
}

/** The state of the subscription in a few words, with its date */
export function billingStatusLine(billing: OrganizationBilling): string {
  switch (billing.status) {
    case 'trialing':
      return billing.trialEndsAt ? `Trial until ${billingDate(billing.trialEndsAt)}` : 'Trial';
    case 'active':
      return billing.nextInvoice?.date ? `Renews ${billingDate(billing.nextInvoice.date)}` : 'Active';
    case 'past_due':
      return billing.graceEndsAt
        ? `Payment failed. The plan's limits stay until ${billingDate(billing.graceEndsAt)}, then Starter's apply`
        : 'Payment failed';
    case 'unpaid':
      return "Unpaid. Starter's limits apply until the invoice is paid";
    case 'canceled':
      return "Canceled. Starter's limits apply";
    case 'incomplete':
      return 'Waiting for the first payment';
    case 'incomplete_expired':
      return 'The first payment did not go through';
    case 'paused':
      return 'Paused';
    default:
      return 'Free, no subscription';
  }
}
