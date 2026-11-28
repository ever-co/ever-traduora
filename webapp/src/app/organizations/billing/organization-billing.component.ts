import { DOCUMENT, NgFor, NgIf } from '@angular/common';
import { Component, DestroyRef, Inject, OnInit } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Store } from '@ngxs/store';
import { BehaviorSubject, combineLatest, EMPTY, Observable, of, timer } from 'rxjs';
import { catchError, distinctUntilChanged, filter, finalize, map, switchMap, take, takeWhile, tap } from 'rxjs/operators';
import { canManage, Organization, usageFigure, usageMeterValue } from '../models/organization';
import { organizationErrorMessage } from '../models/organization-errors';
import { GetOrganizations, OrganizationsState } from '../stores/organizations.state';
import {
  BillingInterval,
  billingDate,
  BillingOffer,
  BillingOrder,
  billingStatusLine,
  MAX_EXTRA_SEATS,
  money,
  OrganizationBilling,
  PAID_PLANS,
  PaidPlan,
  per,
} from './billing.model';
import { BillingService } from './billing.service';

/** How often, and how many times, the page reads the billing again after Checkout, while Stripe's webhook arrives */
const AFTER_CHECKOUT_POLL_MS = 2000;
const AFTER_CHECKOUT_POLLS = 6;

/**
 * /orgs/:slug/billing (DESIGN §3.7, §6): the plan, the seats used, included and bought, the trial and the next invoice,
 * for the owner and the admins. Only the owner gets Upgrade (Stripe Checkout), the change of the plan and seats, and
 * Manage billing (the Stripe customer portal).
 */
@Component({
  selector: 'app-organization-billing',
  imports: [NgIf, NgFor, ReactiveFormsModule],
  templateUrl: './organization-billing.component.html',
  styleUrls: ['./organization-billing.component.css'],
})
export class OrganizationBillingComponent implements OnInit {
  organization: Organization | undefined;
  billing: OrganizationBilling | undefined;
  errorMessage: string | undefined;
  loadFailed = false;
  busy = false;
  saved = false;
  /** Back from Stripe Checkout: `success` or `canceled` */
  returnedFrom: 'success' | 'canceled' | undefined;
  private readonly reload$ = new BehaviorSubject<void>(undefined);

  readonly plans = PAID_PLANS;
  readonly maxExtraSeats = MAX_EXTRA_SEATS;
  readonly usageFigure = usageFigure;
  readonly usageMeterValue = usageMeterValue;
  readonly billingDate = billingDate;
  readonly money = money;
  readonly per = per;

  readonly form = this.fb.group({
    plan: ['small_business' as PaidPlan, Validators.required],
    interval: ['monthly' as BillingInterval, Validators.required],
    extraSeats: [0, Validators.compose([Validators.required, Validators.min(0), Validators.max(MAX_EXTRA_SEATS), Validators.pattern(/^\d+$/)])],
  });

  constructor(
    private readonly store: Store,
    private readonly route: ActivatedRoute,
    private readonly billingService: BillingService,
    private readonly fb: FormBuilder,
    private readonly destroyRef: DestroyRef,
    @Inject(DOCUMENT) private readonly document: Document,
  ) {}

  /** Opens a Stripe page (Checkout, the portal): a full navigation away from the app */
  redirect = (url: string): void => this.document.location.assign(url);

  get canRead(): boolean {
    return canManage(this.organization?.role);
  }

  get statusLine(): string {
    return this.billing ? billingStatusLine(this.billing) : '';
  }

  get selectedPlan() {
    return PAID_PLANS.find(plan => plan.code === this.form.controls.plan.value) ?? PAID_PLANS[0];
  }

  /** The offer of the chosen plan and interval, with Stripe's prices */
  get selectedOffer(): BillingOffer | undefined {
    return this.offerOf(this.form.controls.plan.value as PaidPlan, this.form.controls.interval.value as BillingInterval);
  }

  get extraSeats(): number {
    return this.selectedPlan.sellsSeats ? Math.max(0, Math.floor(Number(this.form.controls.extraSeats.value) || 0)) : 0;
  }

  /** What the order costs an interval, before tax */
  get total(): string {
    const offer = this.selectedOffer;
    if (!offer) {
      return '';
    }
    return money(offer.amount + this.extraSeats * (offer.seatAmount ?? 0), offer.currency);
  }

  /** Whether the order is what the subscription buys already */
  get unchanged(): boolean {
    const billing = this.billing;
    return (
      !!billing?.subscribed &&
      billing.subscribedPlan.code === this.form.controls.plan.value &&
      billing.interval === this.form.controls.interval.value &&
      billing.seats.bought === this.extraSeats
    );
  }

  offerOf(plan: PaidPlan, interval: BillingInterval): BillingOffer | undefined {
    return this.billing?.offers.find(offer => offer.plan === plan && offer.interval === interval);
  }

  ngOnInit(): void {
    this.route.queryParamMap.pipe(take(1)).subscribe(params => {
      const checkout = params.get('checkout');
      this.returnedFrom = checkout === 'success' || checkout === 'canceled' ? checkout : undefined;
    });
    const organization$ = this.store.select(OrganizationsState.currentOrganization).pipe(
      filter((organization): organization is Organization => !!organization),
      distinctUntilChanged((a, b) => a.id === b.id && a.role === b.role),
    );
    combineLatest([organization$, this.reload$])
      .pipe(
        switchMap(([organization]) => {
          // Another organization (the page is reused for it): nothing shown before stays; a reload keeps "Saved"
          if (this.organization?.id !== organization.id) {
            this.billing = undefined;
            this.saved = false;
            this.form.markAsPristine();
          }
          this.organization = organization;
          this.errorMessage = undefined;
          this.loadFailed = false;
          if (organization.isDefault || !canManage(organization.role)) {
            return EMPTY;
          }
          return this.read(organization.id);
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(billing => this.show(billing));
  }

  retry(): void {
    this.reload$.next();
  }

  /** Upgrade (no subscription): to Stripe Checkout. Change (a subscription): the new plan, interval or seats */
  submit(): void {
    const organization = this.organization;
    if (!organization || !this.billing?.canManage || !this.form.valid || this.busy) {
      return;
    }
    const order: BillingOrder = {
      plan: this.form.controls.plan.value as PaidPlan,
      interval: this.form.controls.interval.value as BillingInterval,
      extraSeats: this.extraSeats,
    };
    if (this.billing.subscribed) {
      this.run(this.billingService.changeSubscription(organization.id, order), () => {
        this.saved = true;
        this.store.dispatch(new GetOrganizations());
        this.reload$.next();
      });
    } else {
      this.run(this.billingService.checkout(organization.id, order), url => this.redirect(url));
    }
  }

  /** Manage billing: the payment method, the invoices and cancellation, on the Stripe customer portal */
  manage(): void {
    const organization = this.organization;
    if (!organization || !this.billing?.canManage || this.busy) {
      return;
    }
    this.run(this.billingService.portal(organization.id), url => this.redirect(url));
  }

  /**
   * The billing of the organization. Back from a successful Checkout, Stripe's webhook may come a moment after the
   * page: it reads again a few times until the subscription shows.
   */
  private read(organizationId: string): Observable<OrganizationBilling> {
    const once = () =>
      this.billingService.find(organizationId).pipe(
        catchError(error => {
          this.errorMessage = organizationErrorMessage(error);
          this.loadFailed = true;
          return EMPTY;
        }),
      );
    if (this.returnedFrom !== 'success') {
      return once();
    }
    return timer(0, AFTER_CHECKOUT_POLL_MS).pipe(
      take(AFTER_CHECKOUT_POLLS),
      switchMap(() => once()),
      takeWhile(billing => !billing.subscribed, true),
      tap(billing => {
        if (billing.subscribed) {
          this.store.dispatch(new GetOrganizations());
        }
      }),
    );
  }

  private show(billing: OrganizationBilling): void {
    this.billing = billing;
    if (this.form.pristine || billing.subscribed) {
      const subscribed = billing.subscribed && PAID_PLANS.some(plan => plan.code === billing.subscribedPlan.code);
      this.form.reset({
        plan: subscribed ? (billing.subscribedPlan.code as PaidPlan) : 'small_business',
        interval: subscribed && billing.interval ? billing.interval : 'monthly',
        extraSeats: subscribed ? billing.seats.bought : 0,
      });
    }
  }

  private run<T>(request: Observable<T>, done: (result: T) => void): void {
    const organizationId = this.organization?.id;
    this.busy = true;
    this.errorMessage = undefined;
    this.saved = false;
    request
      .pipe(
        finalize(() => (this.busy = false)),
        map(result => ({ result })),
        catchError(error => {
          if (this.organization?.id === organizationId) {
            this.errorMessage = organizationErrorMessage(error);
          }
          return of(undefined);
        }),
      )
      .subscribe(answer => {
        if (answer && this.organization?.id === organizationId) {
          done(answer.result);
        }
      });
  }
}
