import { AbstractControl, ValidationErrors } from '@angular/forms';
import { Organization } from '../../organizations/models/organization';

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
}

/** One suspension or restore, with who did it and why. */
export interface OperatorAuditEntry {
  id: string;
  action: 'suspend' | 'restore';
  operator: { userId: string; email: string };
  /** `null` when the organization can no longer be found. */
  organization: { id: string; name: string; slug: string } | null;
  reason: string;
  date: { created: string };
}

/** `GET /operator/organizations/:id`: the summary, the effective plan, the live usage and the latest audit rows. */
export interface OperatorOrganizationDetail extends OperatorOrganization {
  plan: { code: Organization['planCode']; name: string };
  /** A `null` included or limit is unlimited. */
  usage: { seats: { used: number; included: number | null }; strings: { used: number; limit: number | null } };
  /** Newest first, at most 20. */
  audit: OperatorAuditEntry[];
}

export interface OperatorPage<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

export type OperatorStatusFilter = '' | Organization['status'];

export interface OperatorOrganizationsQuery {
  q?: string;
  status?: OperatorStatusFilter;
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
