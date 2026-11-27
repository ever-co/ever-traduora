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

/** Plan names as people read them (the limits come with the plans phase). */
export const PLAN_NAMES: Record<Organization['planCode'], string> = {
  starter: 'Starter',
  small_business: 'Small Business',
  enterprise: 'Enterprise',
};

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

/** A slug suggested from a name, as the API derives it: "Acme GmbH & Co." → `acme-gmbh-co`. */
export function slugFromName(name: string): string {
  return (name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

export function isAllowedSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes('--') && !RESERVED_SLUGS.has(slug);
}
