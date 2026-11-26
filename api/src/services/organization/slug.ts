import { randomBytes } from 'crypto';

/** An organization's slug: 3 to 40 lowercase letters, digits and single hyphens, starting and ending with a letter or digit. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

export const SLUG_MIN_LENGTH = 3;
export const SLUG_MAX_LENGTH = 40;

/** Words of the app's own routes and hosts, never an organization's slug (DESIGN §4.1). */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
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

/** Whether `slug` has the slug form (whether it is free is the database's to say). */
export function isWellFormedSlug(slug: string): boolean {
  return typeof slug === 'string' && SLUG_PATTERN.test(slug) && !slug.includes('--');
}

/** Whether a new organization, or a rename, may take `slug`. */
export function isAllowedSlug(slug: string): boolean {
  return isWellFormedSlug(slug) && !RESERVED_SLUGS.has(slug);
}

/**
 * A slug derived from an organization name: "Acme GmbH & Co." → `acme-gmbh-co`. Accents are dropped, anything else
 * becomes a hyphen. A result that is too short or reserved gets a random suffix, so it is always allowed.
 */
export function slugFromName(name: string, suffix: () => string = randomSuffix): string {
  let slug = (name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LENGTH)
    .replace(/-+$/g, '');
  if (slug.length < SLUG_MIN_LENGTH || RESERVED_SLUGS.has(slug)) {
    slug = withSuffix(slug || 'org', suffix());
  }
  return slug;
}

/** `slug` with `-<suffix>`, shortened to stay within the maximum length. */
export function withSuffix(slug: string, suffix: string): string {
  const head = slug.slice(0, SLUG_MAX_LENGTH - suffix.length - 1).replace(/-+$/g, '');
  return `${head}-${suffix}`;
}

export function randomSuffix(): string {
  return randomBytes(3).toString('hex');
}
