import { OrganizationPlanCode } from '../domain/organization-actions';

/**
 * The Stripe prices of the organization plans, by lookup key (DESIGN §3.7), on the shared Ever account:
 * - a plan: `ever_traduora_cloud_<plan>_<interval>` (Starter is free and is never bought);
 * - an extra seat of Small Business: `seat_ever_traduora_cloud_small_business_<interval>`, $5 a month or $60 a year,
 *   the scheme of the fleet's seat prices (`seat_ever_<product>_<hosting>_<tier>_<interval>`), which keeps them out of
 *   the plan filter of the Gauzy app (`ever_gauzy_cloud_`).
 *
 * A subscription's plan and seats are read from these keys only, never from metadata (DESIGN §3.7).
 */
export enum BillingInterval {
  Monthly = 'monthly',
  Annual = 'annual',
}

/** The plans a Checkout sells */
export const PAID_PLANS: ReadonlyArray<OrganizationPlanCode> = [OrganizationPlanCode.SmallBusiness, OrganizationPlanCode.Enterprise];

/** The plans that sell extra seats on top of their own */
const PLANS_WITH_SEATS: ReadonlySet<string> = new Set([OrganizationPlanCode.SmallBusiness]);

const INTERVALS = Object.values(BillingInterval) as string[];
const PLAN_KEY = /^ever_traduora_cloud_(starter|small_business|enterprise)_(monthly|annual)$/;
const SEAT_KEY = /^seat_ever_traduora_cloud_small_business_(monthly|annual)$/;

/** The most a Checkout or a change asks for; the portal of Stripe caps adjustable quantities the same way */
export const MAX_EXTRA_SEATS = 1000;

export function planLookupKey(plan: OrganizationPlanCode, interval: BillingInterval): string {
  return `ever_traduora_cloud_${plan}_${interval}`;
}

export function seatLookupKey(interval: BillingInterval): string {
  return `seat_ever_traduora_cloud_small_business_${interval}`;
}

export function isPaidPlan(plan: unknown): plan is OrganizationPlanCode {
  return typeof plan === 'string' && (PAID_PLANS as string[]).includes(plan);
}

export function isInterval(interval: unknown): interval is BillingInterval {
  return typeof interval === 'string' && INTERVALS.includes(interval);
}

export function sellsSeats(plan: OrganizationPlanCode | string): boolean {
  return PLANS_WITH_SEATS.has(plan);
}

/** One item of a subscription, as the plan is read from it */
export interface PricedItem {
  lookupKey: string | null | undefined;
  quantity?: number | null;
}

/** What a subscription buys, read from its items' lookup keys */
export interface SubscribedPlan {
  planCode: OrganizationPlanCode;
  interval: BillingInterval;
  /** The quantity of the seat price; 0 for a plan without extra seats */
  extraSeats: number;
}

const RANK: Record<string, number> = {
  [OrganizationPlanCode.Starter]: 0,
  [OrganizationPlanCode.SmallBusiness]: 1,
  [OrganizationPlanCode.Enterprise]: 2,
};

/** The order of the plans, Starter lowest */
export function planRank(plan: OrganizationPlanCode | string): number {
  return RANK[plan] ?? 0;
}

/**
 * Whether a change of the subscription raises what it bills, so that it is paid before it applies: a higher plan, the
 * yearly interval instead of the monthly one, or (on the same plan) more extra seats. Seats are not compared across
 * plans: Enterprise to Small Business with a seat is a decrease. Unknown (no Traduora plan read): treated as a raise.
 */
export function raisesTheBill(
  current: SubscribedPlan | null,
  wanted: { plan: OrganizationPlanCode; interval: BillingInterval; extraSeats: number },
): boolean {
  if (!current) {
    return true;
  }
  const yearly = current.interval === BillingInterval.Monthly && wanted.interval === BillingInterval.Annual;
  if (planRank(wanted.plan) !== planRank(current.planCode)) {
    return planRank(wanted.plan) > planRank(current.planCode) || yearly;
  }
  return wanted.extraSeats > current.extraSeats || yearly;
}

/**
 * The plan of a subscription from its items: the plan price (the highest, should there be several), and the quantity of
 * the seat price of the same interval when the plan sells seats. `null` when no item is a Traduora plan price, so a
 * subscription of another product of the shared account is never read as one.
 */
export function subscribedPlan(items: ReadonlyArray<PricedItem>): SubscribedPlan | null {
  let best: { planCode: OrganizationPlanCode; interval: BillingInterval } | null = null;
  for (const item of items) {
    const match = PLAN_KEY.exec(item.lookupKey ?? '');
    if (match && (!best || RANK[match[1]] > RANK[best.planCode])) {
      best = { planCode: match[1] as OrganizationPlanCode, interval: match[2] as BillingInterval };
    }
  }
  if (!best) {
    return null;
  }
  let extraSeats = 0;
  if (sellsSeats(best.planCode)) {
    for (const item of items) {
      const match = SEAT_KEY.exec(item.lookupKey ?? '');
      if (match && match[1] === best.interval) {
        extraSeats += Math.max(0, Math.floor(Number(item.quantity) || 0));
      }
    }
  }
  return { ...best, extraSeats };
}

/** Whether the lookup key is one of the Traduora seat prices */
export function isSeatLookupKey(lookupKey: string | null | undefined): boolean {
  return SEAT_KEY.test(lookupKey ?? '');
}

/** Whether the lookup key is one of the Traduora plan prices */
export function isPlanLookupKey(lookupKey: string | null | undefined): boolean {
  return PLAN_KEY.test(lookupKey ?? '');
}
