/**
 * The wire contract of the anonymous usage statistics (`ever.stats.v1`), in one place.
 *
 * The header names, the signature prefix, the size limit and the schedule constants come from the vendored contract
 * constants (`schema/constants.json`), never typed by hand here.
 */
import * as vendoredConstants from './schema/constants.json';

interface VendoredConstants {
  contracts_version: string;
  stats_headers: { key: string; signature: string; key_id: string };
  stats_signature_prefix: string;
  stats: {
    send_interval_s: number;
    min_interval_s: number;
    max_bytes: number;
    final_resend_days: number[];
    reports_per_day: number;
  };
}

const CONSTANTS = vendoredConstants as unknown as VendoredConstants;

/** The one outbound call of this module: `POST {TR_EVER_STATS_API_URL}/v1/stats/reports`. */
export const STATS_REPORTS_PATH = '/v1/stats/reports';

/** The report signature headers: the statistics public key, the signature and the key id. */
export const STATS_HEADERS = Object.freeze({
  key: CONSTANTS.stats_headers.key,
  signature: CONSTANTS.stats_headers.signature,
  keyId: CONSTANTS.stats_headers.key_id,
});

/** `Ever-Stats-Signature: ed25519=<base64url signature>`. */
export const STATS_SIGNATURE_PREFIX = CONSTANTS.stats_signature_prefix;

/** The largest report body, in bytes (16 KiB). */
export const MAX_STATS_REPORT_BYTES = CONSTANTS.stats.max_bytes;

/** The days of a month on which the previous month is sent once more with `final: true`. */
export const FINAL_RESEND_DAYS: ReadonlyArray<number> = Object.freeze([...CONSTANTS.stats.final_resend_days]);

/** The default and the shortest public interval between two reports, in seconds. */
export const DEFAULT_SEND_INTERVAL_S = CONSTANTS.stats.send_interval_s;
export const MIN_PUBLIC_SEND_INTERVAL_S = CONSTANTS.stats.min_interval_s;

/** The version of the contract the vendored files come from (sent in the `User-Agent`). */
export const CONTRACTS_VERSION = CONSTANTS.contracts_version;

/** The schema id every report carries. */
export const STATS_SCHEMA_ID = 'ever.stats.v1';

/** The version of this module, sent as `module_version`. */
export const MODULE_VERSION = '1.0.0';

/** The product this module reports for. */
export const PRODUCT = 'traduora';

/** The request timeout of a send. */
export const STATS_SEND_TIMEOUT_MS = 10_000;

/** The waits after a failed send (429, 5xx, no answer): +1 h, +4 h, +12 h; then the next day. */
export const STATS_RETRY_DELAYS_S: ReadonlyArray<number> = Object.freeze([3600, 14400, 43200]);

/** How many report rows are kept. */
export const STATS_REPORTS_KEPT = 12;

/** "Send now" may be used once per 10 minutes. */
export const STATS_SEND_NOW_INTERVAL_MS = 10 * 60 * 1000;

/** The sending lease lasts 5 minutes. */
export const STATS_LEASE_MS = 5 * 60 * 1000;

/**
 * How long switching the statistics off, or resetting the identity, waits for a report another API process is sending
 * (two requests of at most 10 seconds each, and their records).
 */
export const STATS_SEND_DRAIN_MS = 30_000;

/** The first report after a restart when the last one is more than a day old. */
export const STATS_OVERDUE_DELAY_MS = 10 * 60 * 1000;

/** How long after the start of the API the scheduler first looks (the migrations run first). */
export const STATS_BOOT_DELAY_MS = 15_000;

/** After a failed start of the scheduler (the database not ready, for example): 30 s, 2 min, then every 10 min. */
export const STATS_BOOT_RETRY_MS: ReadonlyArray<number> = Object.freeze([30_000, 120_000, 600_000]);

/** After a failed slot, the next try. */
export const STATS_RECOVERY_MS = 10 * 60 * 1000;
