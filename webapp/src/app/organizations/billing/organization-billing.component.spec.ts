import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { discardPeriodicTasks, fakeAsync, TestBed, tick } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { NgxsModule, Store } from '@ngxs/store';
import { defer, of } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthState } from '../../auth/stores/auth.state';
import { Organization } from '../models/organization';
import { OrganizationsState } from '../stores/organizations.state';
import { billingStatusLine, money, OrganizationBilling } from './billing.model';
import { OrganizationBillingComponent } from './organization-billing.component';

describe('OrganizationBillingComponent', () => {
  const endpoint = environment.apiEndpoint;
  const url = `${endpoint}/organizations/o1/billing`;
  const organization: Organization = {
    id: 'o1',
    name: 'Acme Translations',
    slug: 'acme',
    status: 'active',
    planCode: 'starter',
    isDefault: false,
    adminsSeeAllProjects: true,
    role: 'owner',
  };
  const offers: OrganizationBilling['offers'] = [
    { plan: 'small_business', interval: 'monthly', amount: 4900, currency: 'usd', seatAmount: 500 },
    { plan: 'small_business', interval: 'annual', amount: 40800, currency: 'usd', seatAmount: 6000 },
    { plan: 'enterprise', interval: 'monthly', amount: 49900, currency: 'usd', seatAmount: null },
    { plan: 'enterprise', interval: 'annual', amount: 418800, currency: 'usd', seatAmount: null },
  ];
  const free: OrganizationBilling = {
    enabled: true,
    plan: { code: 'starter', name: 'Starter' },
    subscribedPlan: { code: 'starter', name: 'Starter' },
    status: null,
    interval: null,
    seats: { used: 3, included: 15, bought: 0, limit: 15 },
    trialEndsAt: null,
    pastDueSince: null,
    graceEndsAt: null,
    nextInvoice: null,
    offers,
    trialAvailable: true,
    trialDays: 90,
    canManage: true,
    subscribed: false,
    portalAvailable: false,
  };
  const subscribed: OrganizationBilling = {
    ...free,
    plan: { code: 'small_business', name: 'Small Business' },
    subscribedPlan: { code: 'small_business', name: 'Small Business' },
    status: 'trialing',
    interval: 'monthly',
    seats: { used: 3, included: 25, bought: 2, limit: 27 },
    trialEndsAt: '2027-02-26T10:00:00.000Z',
    nextInvoice: { date: '2027-02-26T10:00:00.000Z', amount: 5900, currency: 'usd' },
    trialAvailable: false,
    subscribed: true,
    portalAvailable: true,
  };

  let store: Store;
  let http: HttpTestingController;
  let query: Record<string, string>;

  const render = (role: Organization['role'], billing?: OrganizationBilling, extra: Partial<Organization> = {}) => {
    store.reset({
      ...store.snapshot(),
      organizations: {
        ...store.snapshot().organizations,
        organizations: [{ ...organization, role, ...extra }],
        loaded: true,
        currentOrganizationId: 'o1',
      },
    });
    const fixture = TestBed.createComponent(OrganizationBillingComponent);
    spyOn(fixture.componentInstance, 'redirect');
    fixture.detectChanges();
    if (billing) {
      http.expectOne(url).flush({ data: billing });
      fixture.detectChanges();
    }
    return fixture;
  };
  const find = (fixture: any, test: string): HTMLElement | null => fixture.nativeElement.querySelector(`[data-test="${test}"]`);
  const text = (fixture: any, test: string) => (find(fixture, test)?.textContent ?? '').replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    query = {};
    TestBed.configureTestingModule({
      imports: [OrganizationBillingComponent, NgxsModule.forRoot([AuthState, OrganizationsState])],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { queryParamMap: defer(() => of(convertToParamMap(query))) } },
      ],
    });
    store = TestBed.inject(Store);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('shows the owner the free plan, its seats, the plans with their prices and the trial', () => {
    const fixture = render('owner', free);
    expect(text(fixture, 'status')).toBe('Free, no subscription');
    expect(text(fixture, 'seats')).toContain('3 of 15');
    expect(text(fixture, 'seats-split')).toBe('15 included · 0 bought');
    const order = text(fixture, 'order');
    expect(order).toContain('Upgrade');
    expect(order).toContain('Small Business');
    expect(order).toContain('$49.00 a month');
    expect(order).toContain('$499.00 a month');
    expect(text(fixture, 'trial')).toContain('90-day free trial');
    expect(text(fixture, 'total')).toBe('$49.00 a month, plus tax where it applies');
    expect(find(fixture, 'portal')).toBeNull();
  });

  it('sends the owner to Stripe Checkout with the plan, the interval and the extra seats', () => {
    const fixture = render('owner', free);
    const component = fixture.componentInstance;
    component.form.patchValue({ interval: 'annual', extraSeats: 3 });
    fixture.detectChanges();
    expect(text(fixture, 'total')).toBe('$588.00 a year, plus tax where it applies');
    (find(fixture, 'submit') as HTMLButtonElement).click();
    const req = http.expectOne(`${url}/checkout`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ plan: 'small_business', interval: 'annual', extraSeats: 3 });
    req.flush({ data: { url: 'https://checkout.stripe.test/c/1' } });
    expect(component.redirect).toHaveBeenCalledWith('https://checkout.stripe.test/c/1');
  });

  it('sends no extra seats with Enterprise', () => {
    const fixture = render('owner', free);
    fixture.componentInstance.form.patchValue({ plan: 'enterprise', extraSeats: 4 });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#billingExtraSeats')).toBeNull();
    (find(fixture, 'submit') as HTMLButtonElement).click();
    const req = http.expectOne(`${url}/checkout`);
    expect(req.request.body).toEqual({ plan: 'enterprise', interval: 'monthly', extraSeats: 0 });
    req.flush({ data: { url: 'https://checkout.stripe.test/c/2' } });
  });

  it('shows a refusal of the API and sends nowhere', () => {
    const fixture = render('owner', free);
    (find(fixture, 'submit') as HTMLButtonElement).click();
    http.expectOne(`${url}/checkout`).flush({ error: { code: 'subscription_exists', message: 'x' } }, { status: 409, statusText: 'Conflict' });
    fixture.detectChanges();
    expect(text(fixture, 'error')).toContain('The organization has a subscription already');
    expect(fixture.componentInstance.redirect).not.toHaveBeenCalled();
  });

  it('shows a subscription: the trial, the seats bought, the next invoice, and changes it', () => {
    const fixture = render('owner', subscribed);
    expect(text(fixture, 'status')).toBe('Trial until 26 Feb 2027');
    expect(text(fixture, 'seats')).toContain('3 of 27');
    expect(text(fixture, 'seats-split')).toBe('25 included · 2 bought');
    expect(text(fixture, 'next-invoice')).toBe('Next invoice 26 Feb 2027 · $59.00');
    expect(text(fixture, 'order')).toContain('Change the plan');
    const submit = find(fixture, 'submit') as HTMLButtonElement;
    // What it buys already: nothing to save
    expect(submit.disabled).toBe(true);
    fixture.componentInstance.form.patchValue({ extraSeats: 5 });
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);
    submit.click();
    const req = http.expectOne(`${url}/subscription`);
    expect([req.request.method, req.request.body]).toEqual(['PATCH', { plan: 'small_business', interval: 'monthly', extraSeats: 5 }]);
    req.flush({ data: { pending: false } });
    http.expectOne(`${endpoint}/organizations`).flush({ data: [organization] });
    http.expectOne(url).flush({ data: { ...subscribed, seats: { ...subscribed.seats, bought: 5, limit: 30 } } });
    fixture.detectChanges();
    expect(text(fixture, 'seats-split')).toBe('25 included · 5 bought');
  });

  it('says an upgrade waits for the payment of its invoice, and keeps the plan shown', () => {
    const fixture = render('owner', { ...subscribed, status: 'active' });
    fixture.componentInstance.form.patchValue({ plan: 'enterprise' });
    fixture.detectChanges();
    (find(fixture, 'submit') as HTMLButtonElement).click();
    http.expectOne(`${url}/subscription`).flush({ data: { pending: true } });
    http.expectOne(`${endpoint}/organizations`).flush({ data: [organization] });
    http.expectOne(url).flush({ data: { ...subscribed, status: 'active' } });
    fixture.detectChanges();
    expect(text(fixture, 'change-pending')).toContain('waiting for the payment of its invoice');
    expect(text(fixture, 'plan')).toContain('Small Business plan');
    expect(fixture.nativeElement.querySelector('.billing-saved')).toBeNull();
  });

  it('opens the customer portal for the owner', () => {
    const fixture = render('owner', subscribed);
    (find(fixture, 'manage') as HTMLButtonElement).click();
    const req = http.expectOne(`${url}/portal`);
    expect(req.request.method).toBe('POST');
    req.flush({ data: { url: 'https://billing.stripe.test/p/1' } });
    expect(fixture.componentInstance.redirect).toHaveBeenCalledWith('https://billing.stripe.test/p/1');
  });

  it('shows an admin the billing read-only, without Upgrade or Manage billing', () => {
    const fixture = render('admin', { ...subscribed, canManage: false });
    expect(text(fixture, 'plan')).toContain('Small Business plan');
    expect(find(fixture, 'order')).toBeNull();
    expect(find(fixture, 'portal')).toBeNull();
    expect(text(fixture, 'read-only')).toBe('Only the owner changes the plan, the seats and the payment details');
  });

  it('asks nothing for a member, nor for the default organization', () => {
    let fixture = render('member');
    expect(text(fixture, 'not-allowed')).toContain('Only the owner and the admins');
    fixture.destroy();
    fixture = render('owner', undefined, { isDefault: true });
    expect(find(fixture, 'default-organization')).not.toBeNull();
  });

  it('says when billing is not set up', () => {
    const fixture = render('owner', { ...free, enabled: false, offers: [] });
    expect(text(fixture, 'disabled')).toBe('Billing is not set up on this installation');
    expect(find(fixture, 'order')).toBeNull();
  });

  it('back from Checkout, reads again until the subscription arrives', fakeAsync(() => {
    query = { checkout: 'success' };
    const fixture = render('owner');
    tick(0);
    http.expectOne(url).flush({ data: free });
    fixture.detectChanges();
    expect(text(fixture, 'checkout-success')).toContain('Stripe is confirming the subscription');
    tick(2000);
    http.expectOne(url).flush({ data: subscribed });
    http.expectOne(`${endpoint}/organizations`).flush({ data: [organization] });
    fixture.detectChanges();
    expect(text(fixture, 'checkout-success')).toBe('Your Small Business subscription is in place.');
    tick(10_000);
    http.expectNone(url);
    discardPeriodicTasks();
  }));

  it('says a canceled Checkout charged nothing', () => {
    query = { checkout: 'canceled' };
    const fixture = render('owner', free);
    expect(text(fixture, 'checkout-canceled')).toBe('Checkout was canceled. Nothing was charged.');
  });

  describe('the model', () => {
    it('reads the state of a subscription in a few words', () => {
      expect(billingStatusLine({ ...subscribed, status: 'past_due', graceEndsAt: '2026-12-12T00:00:00.000Z' })).toBe(
        "Payment failed. The plan's limits stay until 12 Dec 2026, then Starter's apply",
      );
      expect(billingStatusLine({ ...subscribed, status: 'canceled' })).toBe("Canceled. Starter's limits apply");
      expect(billingStatusLine({ ...subscribed, status: 'active' })).toBe('Renews 26 Feb 2027');
    });

    it('writes amounts in the currency, from cents', () => {
      expect(money(40800, 'usd')).toBe('$408.00');
      expect(money(null, 'usd')).toBe('');
    });
  });
});
