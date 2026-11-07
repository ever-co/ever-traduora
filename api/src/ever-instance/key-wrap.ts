/**
 * The statistics key of this installation and how it is kept at rest.
 *
 * - The key pair is Ed25519 (`generateKeyPairSync('ed25519')`). It signs anonymous usage statistics reports and
 *   nothing else.
 * - The private key is stored encrypted with AES-256-GCM. The encryption key is derived with HKDF-SHA256 from
 *   TR_SECRET, salted with the installation's id, for the purpose `ever-instance/stats-key` (also bound into the
 *   ciphertext as additional data). A random 12-byte IV is drawn for every encryption.
 * - A stored key reads `v1:<iv>:<tag>:<ciphertext>`, each part base64url.
 *
 * Nothing here logs, returns or throws key material or the secret.
 */
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  hkdfSync,
  KeyObject,
  randomBytes,
  sign as edSign,
  verify as edVerify,
} from 'crypto';

const HKDF_INFO = 'ever-instance/stats-key';
const AAD = Buffer.from('ever_instance:stats', 'utf8');

/** A stored key that cannot be read. Carries no key material and no secret. */
export class EverInstanceKeyError extends Error {
  constructor(readonly code: 'malformed' | 'secret_missing' | 'unreadable') {
    super(`The stored statistics key of this installation cannot be read (${code}).`);
    this.name = 'EverInstanceKeyError';
  }
}

function wrappingKey(secret: string, instanceId: string): Buffer {
  if (!secret) {
    throw new EverInstanceKeyError('secret_missing');
  }
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(instanceId, 'utf8'), Buffer.from(HKDF_INFO, 'utf8'), 32));
}

/** Encrypts a PKCS#8 DER private key for storage. */
export function wrapStatsKey(privateKeyDer: Buffer, secret: string, instanceId: string): string {
  const key = wrappingKey(secret, instanceId);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([cipher.update(privateKeyDer), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ciphertext.toString('base64url')].join(':');
}

/** Decrypts a stored key; throws {@link EverInstanceKeyError} (fails closed) when it cannot. */
export function unwrapStatsKey(blob: string, secret: string, instanceId: string): Buffer {
  const parts = typeof blob === 'string' ? blob.split(':') : [];
  if (parts.length !== 4 || parts[0] !== 'v1') {
    throw new EverInstanceKeyError('malformed');
  }
  const key = wrappingKey(secret, instanceId);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64url'));
    decipher.setAAD(AAD);
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]);
  } catch {
    throw new EverInstanceKeyError('unreadable');
  }
}

/** The raw 32-byte public key as base64url without padding (43 characters). */
export function publicKeyToBase64Url(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' });
  if (typeof jwk.x !== 'string' || jwk.crv !== 'Ed25519') {
    throw new TypeError('not an Ed25519 public key');
  }
  return jwk.x;
}

/** A new statistics key pair: the public key (43 base64url characters) and the PKCS#8 DER private key. */
export function generateStatsKeyPair(): { publicKey: string; privateKeyDer: Buffer } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKey: publicKeyToBase64Url(publicKey),
    privateKeyDer: privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer,
  };
}

/** The key id Ever Platform derives from a public key: base64url of the first 8 bytes of its SHA-256. */
export function keyIdOf(publicKey: string): string {
  const raw = Buffer.from(publicKey, 'base64url');
  if (raw.length !== 32 || raw.toString('base64url') !== publicKey) {
    throw new TypeError('not a base64url Ed25519 public key');
  }
  return createHash('sha256').update(raw).digest().subarray(0, 8).toString('base64url');
}

/** The public key of a PKCS#8 DER Ed25519 private key. */
export function publicKeyOfPrivate(privateKeyDer: Buffer): string {
  return publicKeyToBase64Url(createPublicKey(createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' })));
}

/** The Ed25519 signature (64 bytes) of exactly `bytes`. */
export function signBytes(privateKeyDer: Buffer, bytes: Uint8Array): Buffer {
  return edSign(null, bytes, createPrivateKey({ key: privateKeyDer, format: 'der', type: 'pkcs8' }));
}

/** Whether `signature` is the Ed25519 signature of `bytes` by the raw base64url `publicKey`. */
export function verifyBytes(publicKey: string, bytes: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: publicKey }, format: 'jwk' });
  return edVerify(null, bytes, key, signature);
}
