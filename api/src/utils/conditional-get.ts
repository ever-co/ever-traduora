import { createHash } from 'node:crypto';

/**
 * Builds a strong entity tag from a response body: identical bytes always give the same tag,
 * so a client that downloaded a file before can ask whether it changed.
 */
export function computeEtag(body: string | Buffer): string {
  const digest = createHash('sha256').update(body).digest('base64url');
  return `"${digest}"`;
}

/** The entity tags of a list, weak or strong, each read whole: a comma or a `*` inside the quotes is part of the tag */
const ENTITY_TAGS = /(?:W\/)?"[^"]*"/g;

/**
 * Tells whether an `If-None-Match` request header matches the given entity tag.
 * Handles `*` (as the whole field value only), comma separated lists and weak validators (`W/"..."`); a weak tag
 * matches for `If-None-Match` (RFC 9110, section 13.1.2).
 */
export function ifNoneMatchMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) {
    return false;
  }

  const current = stripWeakPrefix(etag);
  const fields = Array.isArray(header) ? header : [header];

  return fields.some(field => field.trim() === '*' || (field.match(ENTITY_TAGS) ?? []).some(tag => stripWeakPrefix(tag) === current));
}

function stripWeakPrefix(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}
