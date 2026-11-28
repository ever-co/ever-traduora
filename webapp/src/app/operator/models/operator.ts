import { AbstractControl, ValidationErrors } from '@angular/forms';
import { Params } from '@angular/router';
import { Organization } from '../../organizations/models/organization';

/**
 * Where the cancellation of a deleted organization's subscription stands: it runs after the deletion, with retries, and
 * a failed one needs an operator. `null`: there was nothing to cancel.
 */
export type BillingCancellationStatus = 'pending' | 'failed' | 'done';

/** Whether the cancellation still waits for something (pending) or someone (failed). */
export function billingUnsettled(status: BillingCancellationStatus | null | undefined): boolean {
  return status === 'pending' || status === 'failed';
}

/** An organization as the operators of the installation see it (`GET /operator/organizations`). */
export interface OperatorOrganization {
  id: string;
  name: string;
  slug: string;
  status: Organization['status'];
  /** The plan the organization is on; the detail's `plan` is the effective one (Starter once a paid plan lapsed). */
  planCode: Organization['planCode'];
  isDefault: boolean;
  /** `null` for an organization without an owner (a closed one). */
  owner: { userId: string; name: string; email: string } | null;
  membersCount: number;
  projectsCount: number;
  /** The cached counters; the detail counts them live. */
  seatsUsed: number;
  stringsUsed: number;
  date: { created: string; modified: string };
  billingCancellation: BillingCancellationStatus | null;
}

export type OperatorAuditAction = 'suspend' | 'restore' | 'release_slug' | 'retry_billing_cancellation';

/** The audit log's words for each operator action (mono, lowercase, like the statuses). */
const AUDIT_ACTION_LABELS: Record<OperatorAuditAction, string> = {
  suspend: 'suspend',
  restore: 'restore',
  release_slug: 'release address',
  retry_billing_cancellation: 'retry billing',
};

/** An action this version does not know yet reads as the API names it. */
export function auditActionLabel(action: string): string {
  return Object.prototype.hasOwnProperty.call(AUDIT_ACTION_LABELS, action) ? AUDIT_ACTION_LABELS[action as OperatorAuditAction] : action;
}

/** One operator action on an organization, with who did it and why. */
export interface OperatorAuditEntry {
  id: string;
  action: OperatorAuditAction;
  operator: { userId: string; email: string };
  /** `null` when the organization can no longer be found. */
  organization: { id: string; name: string; slug: string } | null;
  reason: string;
  date: { created: string };
}

/** The cancellation of a deleted organization's subscription, as the detail shows it. */
export interface BillingCancellation {
  status: BillingCancellationStatus;
  attempts: number;
  lastError: string | null;
  date: { created: string; modified: string };
}

/** `GET /operator/organizations/:id`: the summary, the effective plan, the live usage and the latest audit rows. */
export interface OperatorOrganizationDetail extends Omit<OperatorOrganization, 'billingCancellation'> {
  plan: { code: Organization['planCode']; name: string };
  /** A `null` included or limit is unlimited. */
  usage: { seats: { used: number; included: number | null }; strings: { used: number; limit: number | null } };
  /** Newest first, at most 20. */
  audit: OperatorAuditEntry[];
  billingCancellation: BillingCancellation | null;
}

/**
 * The address of a deleted organization once an operator released it: `deleted-` and 32 hex digits, so the original
 * address can be taken again.
 */
export function slugReleased(slug: string): boolean {
  return /^deleted-[0-9a-f]{32}$/.test(slug);
}

export interface OperatorPage<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

export type OperatorStatusFilter = '' | Organization['status'];

/** `unsettled`: only the organizations whose billing cancellation is pending or failed. */
export type OperatorBillingFilter = '' | 'unsettled';

export interface OperatorOrganizationsQuery {
  q?: string;
  status?: OperatorStatusFilter;
  billing?: OperatorBillingFilter;
  page?: number;
  limit?: number;
}

export interface OperatorAuditQuery {
  organizationId?: string;
  page?: number;
  limit?: number;
}

/** Rows per page on the operator lists (the API's default). */
export const OPERATOR_PAGE_SIZE = 25;

/** The reason of a suspension or a restore: 3 to 500 characters after trimming, as the API checks it. */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

export function reasonValidator(control: AbstractControl): ValidationErrors | null {
  const length = String(control.value ?? '').trim().length;
  if (length < REASON_MIN) {
    return { reasonShort: true };
  }
  return length > REASON_MAX ? { reasonLong: true } : null;
}

export const STATUS_FILTERS: { value: OperatorStatusFilter; label: string }[] = [
  { value: '', label: 'Any status' },
  { value: 'active', label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'deleted', label: 'Deleted' },
];

/** A page number from a query parameter: a whole number from 1, else 1. */
export function pageFromParam(value: string | null): number {
  const page = Number(value);
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** The list's search, filters and page, as its address carries them. */
export interface OperatorListState {
  q: string;
  status: OperatorStatusFilter;
  billing: OperatorBillingFilter;
  page: number;
}

/** The list's state from an address; anything unknown reads as unset. */
export function listStateFromParams(params: { get(name: string): string | null }): OperatorListState {
  const status = params.get('status') ?? '';
  return {
    q: (params.get('q') ?? '').trim().slice(0, 100),
    status: STATUS_FILTERS.some(filter => filter.value === status) ? (status as OperatorStatusFilter) : '',
    billing: params.get('billing') === 'unsettled' ? 'unsettled' : '',
    page: pageFromParam(params.get('page')),
  };
}

/**
 * The query parameters of the list's address: only what is set, so an unfiltered list keeps a bare address. A `null`
 * value removes the parameter (router navigation and links both drop it).
 */
export function listQueryParams(state: OperatorListState): Params {
  return {
    q: state.q || null,
    status: state.status || null,
    billing: state.billing || null,
    page: state.page > 1 ? state.page : null,
  };
}
