export type OrganizationRole = 'owner' | 'admin' | 'member';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleted';
  planCode: 'starter' | 'small_business' | 'enterprise';
  isDefault: boolean;
  adminsSeeAllProjects: boolean;
  role: OrganizationRole;
}

export interface OrganizationMember {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
}

export interface OrganizationInvite {
  id: string;
  email: string;
  role: OrganizationRole;
  status: 'sent' | 'accepted';
  inviteUrl?: string;
}

/** Plan names as people read them. */
export const PLAN_NAMES: Record<Organization['planCode'], string> = {
  starter: 'Starter',
  small_business: 'Small Business',
  enterprise: 'Enterprise',
};

/**
 * The plan of an organization and what it uses of it (`GET /organizations/:id/usage`, owner and admins). The plan is the
 * effective one: Starter once a paid subscription lapsed. A `null` limit is unlimited.
 */
export interface OrganizationUsage {
  plan: { code: Organization['planCode']; name: string };
  seats: { used: number; included: number | null };
  strings: { used: number; limit: number | null };
}

const figures = new Intl.NumberFormat('en-US');

/** "1,200 of 10,000", or "3, no limit". */
export function usageFigure(used: number, limit: number | null): string {
  return limit === null ? `${figures.format(used)}, no limit` : `${figures.format(used)} of ${figures.format(limit)}`;
}

/** How full a limit is, from 0 to 100 (an organization over its limit after a downgrade shows full). */
export function usageShare(used: number, limit: number | null): number {
  if (limit === null || limit <= 0) {
    return limit === 0 ? 100 : 0;
  }
  return Math.min(100, Math.round((used / limit) * 100));
}

/** "1 member", "3 members". */
export function countOf(count: number, one: string, many: string): string {
  const noun = count === 1 ? one : many;
  return `${count} ${noun}`;
}

/** Whether the role may rename the organization and manage its members and invites. */
export function canManage(role: OrganizationRole | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Same rule as the API (DESIGN §4.1): 3 to 40 lowercase letters, digits and single inner hyphens. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const RESERVED_SLUGS = new Set([
  'app',
  'api',
  'www',
  'admin',
  'default',
  'operator',
  'billing',
  'auth',
  'login',
  'signup',
  'settings',
  'new',
  'orgs',
  'projects',
  'ever',
  'traduora',
  'help',
  'support',
  'status',
  'docs',
]);

/**
 * A slug suggested from a name, as the API derives it: "Acme GmbH & Co." → `acme-gmbh-co`. One pass over the
 * characters, without a regular expression, so its time is linear on any input.
 */
export function slugFromName(name: string): string {
  const out: string[] = [];
  for (const char of (name || '').normalize('NFKD').toLowerCase()) {
    const code = char.charCodeAt(0);
    if (code >= 0x300 && code <= 0x36f) {
      // A combining accent (é is e + U+0301): dropped
      continue;
    }
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
      out.push(char);
    } else if (out.length > 0 && out[out.length - 1] !== '-') {
      out.push('-');
    }
  }
  const slug = out.join('').slice(0, 40);
  let end = slug.length;
  while (end > 0 && slug[end - 1] === '-') {
    end--;
  }
  return slug.slice(0, end);
}

export function isAllowedSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes('--') && !RESERVED_SLUGS.has(slug);
}
