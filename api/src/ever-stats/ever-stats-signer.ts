import { signBytes } from '../ever-instance/key-wrap';
import { STATS_SIGNATURE_PREFIX } from './ever-stats.constants';

/**
 * The `Ever-Stats-Signature` value of a report: `ed25519=<base64url signature>` over exactly `bytes`, the serialisation
 * that is stored and sent unchanged (no canonicalisation), with the installation's statistics key.
 */
export function signStatsReport(privateKeyDer: Buffer, bytes: Uint8Array): string {
  return `${STATS_SIGNATURE_PREFIX}${signBytes(privateKeyDer, bytes).toString('base64url')}`;
}
