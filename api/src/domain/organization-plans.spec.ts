import { OrganizationPlanCode } from './organization-actions';
import { effectivePlan, ORGANIZATION_PLANS, planOf, withinLimit } from './organization-plans';

const NOW = new Date('2026-11-27T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

describe('the organization plans', () => {
  it('are the three plans of DESIGN §3.6', () => {
    expect(ORGANIZATION_PLANS).toEqual({
      starter: { code: 'starter', name: 'Starter', seats: 15, extraSeats: false, strings: 10_000 },
      small_business: { code: 'small_business', name: 'Small Business', seats: 25, extraSeats: true, strings: null },
      enterprise: { code: 'enterprise', name: 'Enterprise', seats: null, extraSeats: false, strings: null },
    });
    expect(Object.isFrozen(ORGANIZATION_PLANS)).toBe(true);
  });

  it('answer Starter for a code that is no plan', () => {
    expect(planOf('gold').code).toBe(OrganizationPlanCode.Starter);
    expect(planOf('constructor').code).toBe(OrganizationPlanCode.Starter);
    expect(planOf(OrganizationPlanCode.Enterprise).code).toBe(OrganizationPlanCode.Enterprise);
  });
});

describe('withinLimit', () => {
  it('allows up to the limit, and anything without one', () => {
    expect(withinLimit(15, 14, 1)).toBe(true);
    expect(withinLimit(15, 15, 0)).toBe(true);
    expect(withinLimit(15, 15, 1)).toBe(false);
    expect(withinLimit(15, 16, 0)).toBe(false);
    expect(withinLimit(10_000, 9_990, 10)).toBe(true);
    expect(withinLimit(10_000, 9_990, 11)).toBe(false);
    expect(withinLimit(null, 1_000_000, 1_000_000)).toBe(true);
  });
});

describe('effectivePlan', () => {
  const at = (organization: Parameters<typeof effectivePlan>[0], graceDays = 14) => effectivePlan(organization, graceDays, NOW);

  it('is the plan as it is without billing fields (no subscription, before P4)', () => {
    expect(at({ planCode: OrganizationPlanCode.Starter })).toEqual({ plan: ORGANIZATION_PLANS.starter, seats: 15, strings: 10_000 });
    expect(at({ planCode: OrganizationPlanCode.SmallBusiness })).toEqual({ plan: ORGANIZATION_PLANS.small_business, seats: 25, strings: null });
    expect(at({ planCode: OrganizationPlanCode.Enterprise })).toEqual({ plan: ORGANIZATION_PLANS.enterprise, seats: null, strings: null });
    expect(at({ planCode: OrganizationPlanCode.SmallBusiness, billingStatus: null, pastDueSince: null }).plan.code).toBe('small_business');
  });

  it('adds the extra seats bought to Small Business only', () => {
    expect(at({ planCode: OrganizationPlanCode.SmallBusiness, extraSeats: 5 }).seats).toBe(30);
    expect(at({ planCode: OrganizationPlanCode.Starter, extraSeats: 5 }).seats).toBe(15);
    expect(at({ planCode: OrganizationPlanCode.Enterprise, extraSeats: 5 }).seats).toBeNull();
    expect(at({ planCode: OrganizationPlanCode.SmallBusiness, extraSeats: -3 }).seats).toBe(25);
    expect(at({ planCode: OrganizationPlanCode.SmallBusiness, extraSeats: 2.7 }).seats).toBe(27);
  });

  it('keeps the plan while the subscription is active or trialing', () => {
    for (const billingStatus of ['active', 'trialing', 'incomplete']) {
      expect(at({ planCode: OrganizationPlanCode.SmallBusiness, billingStatus }).plan.code).toBe('small_business');
    }
  });

  it('falls back to Starter at once when the subscription is canceled, unpaid or incomplete_expired', () => {
    for (const billingStatus of ['canceled', 'unpaid', 'incomplete_expired']) {
      const plan = at({ planCode: OrganizationPlanCode.SmallBusiness, billingStatus, extraSeats: 10 });
      expect(plan).toEqual({ plan: ORGANIZATION_PLANS.starter, seats: 15, strings: 10_000 });
      expect(at({ planCode: OrganizationPlanCode.Enterprise, billingStatus }).plan.code).toBe('starter');
    }
  });

  it('keeps the plan for the grace days of past_due, then falls back to Starter', () => {
    const pastDue = (since: Date | string | null, graceDays = 14) =>
      at({ planCode: OrganizationPlanCode.SmallBusiness, billingStatus: 'past_due', pastDueSince: since, extraSeats: 3 }, graceDays).plan.code;
    expect(pastDue(daysAgo(1))).toBe('small_business');
    expect(pastDue(daysAgo(14))).toBe('small_business');
    expect(pastDue(daysAgo(14.01))).toBe('starter');
    expect(pastDue(daysAgo(30))).toBe('starter');
    expect(pastDue(daysAgo(30).toISOString())).toBe('starter');
    expect(pastDue(daysAgo(3), 2)).toBe('starter');
    expect(pastDue(daysAgo(1), 0)).toBe('starter');
    // Not known since when: the plan stays (P4 sets the date with the status)
    expect(pastDue(null)).toBe('small_business');
    // A date that cannot be read never hides a lapse
    expect(pastDue('not a date')).toBe('starter');
  });
});
