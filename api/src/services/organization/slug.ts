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

/** `text` without the hyphens at its end. */
function trimTrailingHyphens(text: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === '-') {
    end--;
  }
  return text.slice(0, end);
}

/**
 * The letters and digits of a name in lowercase, every other run as one hyphen, no hyphen at either end. One pass over
 * the characters, without a regular expression, so its time is linear on any input.
 */
function slugBase(name: string): string {
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
  return trimTrailingHyphens(out.join('').slice(0, SLUG_MAX_LENGTH));
}

/**
 * A slug derived from an organization name: "Acme GmbH & Co." → `acme-gmbh-co`. Accents are dropped, anything else
 * becomes a hyphen. A result that is too short or reserved gets a random suffix, so it is always allowed.
 */
export function slugFromName(name: string, suffix: () => string = randomSuffix): string {
  const slug = slugBase(name);
  if (slug.length < SLUG_MIN_LENGTH || RESERVED_SLUGS.has(slug)) {
    return withSuffix(slug || 'org', suffix());
  }
  return slug;
}

/** `slug` with `-<suffix>`, shortened to stay within the maximum length. */
export function withSuffix(slug: string, suffix: string): string {
  const head = trimTrailingHyphens(slug.slice(0, SLUG_MAX_LENGTH - suffix.length - 1));
  return `${head}-${suffix}`;
}

export function randomSuffix(): string {
  return randomBytes(3).toString('hex');
}
