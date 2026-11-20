import { createHash } from 'crypto';

/**
 * Builds a strong entity tag from a response body: identical bytes always give the same tag,
 * so a client that downloaded a file before can ask whether it changed.
 */
export function computeEtag(body: string | Buffer): string {
  const digest = createHash('sha256').update(body).digest('base64url');
  return `"${digest}"`;
}

/**
 * Tells whether an `If-None-Match` request header matches the given entity tag.
 * Handles `*`, comma separated lists and weak validators (`W/"..."`); a weak tag matches
 * for `If-None-Match` (RFC 9110, section 13.1.2).
 */
export function ifNoneMatchMatches(header: string | string[] | undefined, etag: string): boolean {
  if (!header) {
    return false;
  }

  const raw = Array.isArray(header) ? header.join(',') : header;
  const current = stripWeakPrefix(etag);

  return raw
    .split(',')
    .map(candidate => candidate.trim())
    .filter(candidate => candidate !== '')
    .some(candidate => candidate === '*' || stripWeakPrefix(candidate) === current);
}

function stripWeakPrefix(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}
