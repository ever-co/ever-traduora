import { OrganizationPlanCode } from '../domain/organization-actions';
import { BillingInterval, isPaidPlan, planLookupKey, seatLookupKey, subscribedPlan } from './billing-plans';

describe('the plan prices by lookup key', () => {
  const item = (lookupKey: string | null, quantity = 1) => ({ lookupKey, quantity });

  it('names the prices of the shared account', () => {
    expect(planLookupKey(OrganizationPlanCode.SmallBusiness, BillingInterval.Monthly)).toBe('ever_traduora_cloud_small_business_monthly');
    expect(planLookupKey(OrganizationPlanCode.Enterprise, BillingInterval.Annual)).toBe('ever_traduora_cloud_enterprise_annual');
    expect(seatLookupKey(BillingInterval.Annual)).toBe('seat_ever_traduora_cloud_small_business_annual');
  });

  it('sells Small Business and Enterprise only', () => {
    expect(isPaidPlan('small_business')).toBe(true);
    expect(isPaidPlan('enterprise')).toBe(true);
    expect(isPaidPlan('starter')).toBe(false);
    expect(isPaidPlan('gold')).toBe(false);
    expect(isPaidPlan(undefined)).toBe(false);
  });

  it('reads the plan, the interval and the extra seats', () => {
    expect(subscribedPlan([item('ever_traduora_cloud_small_business_annual'), item('seat_ever_traduora_cloud_small_business_annual', 4)])).toEqual({
      planCode: 'small_business',
      interval: 'annual',
      extraSeats: 4,
    });
    expect(subscribedPlan([item('ever_traduora_cloud_enterprise_monthly')])).toEqual({ planCode: 'enterprise', interval: 'monthly', extraSeats: 0 });
  });

  it('counts no seats for a plan that sells none, nor seats of another interval', () => {
    expect(
      subscribedPlan([item('ever_traduora_cloud_enterprise_monthly'), item('seat_ever_traduora_cloud_small_business_monthly', 9)])?.extraSeats,
    ).toBe(0);
    expect(
      subscribedPlan([item('ever_traduora_cloud_small_business_monthly'), item('seat_ever_traduora_cloud_small_business_annual', 9)])?.extraSeats,
    ).toBe(0);
  });

  it('reads nothing from a subscription of another product, nor from seats alone', () => {
    expect(subscribedPlan([item('ever_gauzy_cloud_enterprise_monthly')])).toBeNull();
    expect(subscribedPlan([item('ever_traduora_selfhosted_small_business_annual')])).toBeNull();
    expect(subscribedPlan([item('seat_ever_traduora_cloud_small_business_monthly', 3)])).toBeNull();
    expect(subscribedPlan([item(null)])).toBeNull();
    expect(subscribedPlan([])).toBeNull();
  });

  it('takes the highest plan should there be several, and no negative or fractional seats', () => {
    expect(subscribedPlan([item('ever_traduora_cloud_small_business_monthly'), item('ever_traduora_cloud_enterprise_monthly')])?.planCode).toBe(
      'enterprise',
    );
    expect(
      subscribedPlan([item('ever_traduora_cloud_small_business_monthly'), item('seat_ever_traduora_cloud_small_business_monthly', -3)])?.extraSeats,
    ).toBe(0);
    expect(
      subscribedPlan([item('ever_traduora_cloud_small_business_monthly'), item('seat_ever_traduora_cloud_small_business_monthly', 2.7)])?.extraSeats,
    ).toBe(2);
  });
});
