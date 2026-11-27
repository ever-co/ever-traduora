import { OrganizationPlanCode } from './organization-actions';

/**
 * The plans of an organization in SaaS mode (DESIGN §3.6): a code constant, not rows of the `plan` table, which stays
 * for the projects of a single-tenant install. `null` is unlimited.
 */
export interface OrganizationPlan {
  code: OrganizationPlanCode;
  name: string;
  /** Members plus pending invitations included in the plan */
  seats: number | null;
  /** Whether seats can be bought on top of `seats` (`extraSeats`) */
  extraSeats: boolean;
  /** The sum over the organization's projects of locales × terms */
  strings: number | null;
}

export const ORGANIZATION_PLANS: Readonly<Record<OrganizationPlanCode, OrganizationPlan>> = Object.freeze({
  [OrganizationPlanCode.Starter]: { code: OrganizationPlanCode.Starter, name: 'Starter', seats: 15, extraSeats: false, strings: 10_000 },
  [OrganizationPlanCode.SmallBusiness]: {
    code: OrganizationPlanCode.SmallBusiness,
    name: 'Small Business',
    seats: 25,
    extraSeats: true,
    strings: null,
  },
  [OrganizationPlanCode.Enterprise]: { code: OrganizationPlanCode.Enterprise, name: 'Enterprise', seats: null, extraSeats: false, strings: null },
});

/** The subscription states that end a paid plan at once (Stripe's names): the organization gets Starter's limits */
const LAPSED_STATUSES: ReadonlySet<string> = new Set(['canceled', 'unpaid', 'incomplete_expired']);

const PAST_DUE = 'past_due';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the effective plan reads of an organization. The billing fields come with P4 (DESIGN §4.1); until then they are
 * missing, which means no subscription: the organization's `planCode` as it is.
 */
export interface PlanHolder {
  planCode: OrganizationPlanCode | string;
  billingStatus?: string | null;
  pastDueSince?: Date | string | null;
  extraSeats?: number | null;
}

export interface EffectivePlan {
  plan: OrganizationPlan;
  /** The seats limit, with the extra seats bought; `null` is unlimited */
  seats: number | null;
  /** The strings limit; `null` is unlimited */
  strings: number | null;
}

/** The plan of a code, Starter for a code that is no plan (never more than the free plan by mistake). */
export function planOf(code: OrganizationPlanCode | string): OrganizationPlan {
  return Object.prototype.hasOwnProperty.call(ORGANIZATION_PLANS, code)
    ? ORGANIZATION_PLANS[code as OrganizationPlanCode]
    : ORGANIZATION_PLANS.starter;
}

/**
 * The plan whose limits apply now (DESIGN §3.6, OD-T14): the organization's own, except Starter when its subscription
 * was canceled, is unpaid or expired before its first payment, or has been past due for more than `graceDays`.
 */
export function effectivePlan(organization: PlanHolder, graceDays: number, now: Date = new Date()): EffectivePlan {
  const plan = isLapsed(organization, graceDays, now) ? ORGANIZATION_PLANS.starter : planOf(organization.planCode);
  const extra = plan.extraSeats ? Math.max(0, Math.floor(Number(organization.extraSeats) || 0)) : 0;
  return { plan, seats: plan.seats === null ? null : plan.seats + extra, strings: plan.strings };
}

function isLapsed(organization: PlanHolder, graceDays: number, now: Date): boolean {
  const status = organization.billingStatus;
  if (!status) {
    return false;
  }
  if (LAPSED_STATUSES.has(status)) {
    return true;
  }
  if (status !== PAST_DUE || !organization.pastDueSince) {
    return false;
  }
  const since = new Date(organization.pastDueSince).getTime();
  // A date that cannot be read is treated as past due since forever: the grace never hides a lapse
  return Number.isNaN(since) || now.getTime() - since > Math.max(0, graceDays) * DAY_MS;
}

/** Whether `used + adding` stays within `limit` (`null` is unlimited). */
export function withinLimit(limit: number | null, used: number, adding: number): boolean {
  return limit === null || used + adding <= limit;
}
