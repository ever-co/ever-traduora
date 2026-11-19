import { createHash } from 'crypto';

// SHA-256 of passwords published with traduora: the default admin password that the seed used in v0.21.0 and v0.22.0,
// also listed in the README and .env.sample. Anyone can sign in with them, so they are never accepted.
const PUBLISHED_PASSWORD_HASHES = new Set(['b3408e1f68d863c8cfa954df53ad64d79052a5f2e1f3ca7abebfa0b539374cea']);

export const isPublishedPassword = (password: string | undefined): boolean =>
  !!password && PUBLISHED_PASSWORD_HASHES.has(createHash('sha256').update(password).digest('hex'));
