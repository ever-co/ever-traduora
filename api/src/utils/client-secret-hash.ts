import { createHash } from 'crypto';

/**
 * Short hash of a project client's stored (bcrypt) secret. Client tokens carry it as the `sh` claim, and only work while
 * it matches: rotating the secret stores a new bcrypt hash, so the tokens issued with the old secret stop working.
 */
export const clientSecretHash = (encryptedSecret: Buffer | null | undefined): string | undefined =>
  encryptedSecret ? createHash('sha256').update(encryptedSecret).digest('hex').slice(0, 16) : undefined;
