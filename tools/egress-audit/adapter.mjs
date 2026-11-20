/**
 * The Ever Traduora adapter of the egress audit (see README.md). It runs inside the sealed audit setup, in the
 * harness's driver container, so it reaches the API as `api` and the mail catcher as `mailpit`.
 *
 * Nothing here is a secret: the operator account exists only in the run's throwaway database (see
 * docker-compose.audit.yml), which nothing outside the sealed setup can reach.
 */
const OPERATOR_EMAIL = 'egress-audit-operator@example.test';
const OPERATOR_PASSWORD = 'egress-audit-only-operator-account';
// Plain http on purpose: the mail catcher inside the sealed audit setup.
const MAIL = 'http://mailpit:8025'; // NOSONAR

/**
 * How long the adapter waits for the verification mail. With the loaded_off interval below (240 s), the whole setup
 * (health, sign-in, mail, switch-off) ends long before the statistics scheduler's first slot, and the watched window
 * (wait_s, 300 s after the setup) still holds that slot.
 */
const MAIL_TIMEOUT_MS = 60_000;

/** Every request of the adapter ends within this time (the harness's fetch has no timeout of its own). */
const REQUEST_TIMEOUT_MS = 10_000;

/** The least time left before the statistics scheduler's first slot when the operator switches them off (loaded_off). */
const SLOT_MARGIN_MS = 30_000;

/** The harness's fetch, with a timeout on every request. */
const timed =
  fetch =>
  (url, init = {}) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

async function json(fetch, url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

/** The verification token of the newest mail to the operator in the catcher, once it arrived. */
async function verificationToken({ fetch, log }) {
  const deadline = Date.now() + MAIL_TIMEOUT_MS;
  for (;;) {
    if (Date.now() >= deadline) {
      throw new Error('the verification mail never reached the mail catcher');
    }
    try {
      const list = await json(fetch, `${MAIL}/api/v1/messages?limit=20`);
      for (const message of list.body?.messages ?? []) {
        if (!(message.To ?? []).some(to => String(to.Address).toLowerCase() === OPERATOR_EMAIL)) continue;
        const full = await json(fetch, `${MAIL}/api/v1/message/${encodeURIComponent(message.ID)}`);
        const match = /verify-email\?token=([A-Za-z0-9_-]+)/.exec(`${full.body?.Text ?? ''}\n${full.body?.HTML ?? ''}`);
        if (match) return match[1];
      }
    } catch (error) {
      log?.(`mail catcher: ${error.message}`);
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

/**
 * The operator confirms their e-mail (an operator of the Ever Platform routes must have a confirmed one), through a
 * verification link read from the mail catcher, as a person would.
 */
async function confirmEmail({ baseUrl, fetch, headers, log }) {
  const resend = await fetch(`${baseUrl}/api/v1/auth/resend-verification-email`, { method: 'POST', headers });
  await resend.text();
  log?.(`verification mail: ${resend.status}`);
  const token = await verificationToken({ fetch, log });
  const verified = await fetch(`${baseUrl}/api/v1/auth/verify-email`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  await verified.text();
  log?.(`verify e-mail: ${verified.status}`);
  if (verified.status !== 200) {
    throw new Error(`the operator could not confirm their e-mail (${verified.status})`);
  }
}

/** What the Ever Platform routes must answer the operator, by mode: the modules loaded in it, or none in off. */
const LOADED = {
  off: { stats: false, connect: false },
  loaded_off: { stats: true, connect: true },
  positive_stats: { stats: true, connect: false },
  positive_connect: { stats: false, connect: true },
};

export default {
  /**
   * Extra environment of each mode, without the product prefix (the harness adds TR_). loaded_off: a local reporting
   * address outside the sealed setup and a 240-second interval: the first slot comes after the operator's switch-off
   * (the setup takes at most about 100 seconds, the mail wait included), and inside the watched window, so the
   * scheduler asks after the switch-off (and a report, if one were sent, would show as a connection attempt).
   */
  env: {
    // A private address outside the sealed setup: nothing answers there, and a send would show.
    loaded_off: { EVER_STATS_API_URL: 'http://10.231.8.1:8080', EVER_STATS_SEND_INTERVAL_S: '240' }, // NOSONAR
  },

  /**
   * Signs in as the operator the API created at its first start, and confirms their e-mail so that the operator routes
   * answer them in every mode; later hooks send these headers.
   */
  async login({ baseUrl, fetch: untimed, log }) {
    const fetch = timed(untimed);
    const token = await json(fetch, `${baseUrl}/api/v1/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ grant_type: 'password', username: OPERATOR_EMAIL, password: OPERATOR_PASSWORD }),
    });
    if (token.status !== 200 || !token.body?.access_token) {
      throw new Error(`the operator could not sign in (${token.status})`);
    }
    log?.('operator: signed in');
    const headers = { Authorization: `Bearer ${token.body.access_token}` };
    await confirmEmail({ baseUrl, fetch, headers, log });
    return headers;
  },

  /** What a user would create; nothing is needed for the statistics. */
  async createFixtures() {
    return {};
  },

  /**
   * Opens what the Ever Platform page reads, as the operator, and checks that each route answers as the mode loads it
   * (200 for a loaded module, 404 otherwise): a run whose settings never opened proves nothing about them.
   */
  async openSettings({ baseUrl, fetch: untimed, headers, log, mode }) {
    const fetch = timed(untimed);
    const loaded = LOADED[mode] ?? null;
    const routes = [
      ['/api/v1/ever-platform/status', loaded && (loaded.stats || loaded.connect)],
      ['/api/v1/ever-stats/status', loaded && loaded.stats],
      ['/api/v1/ever-stats/reports', loaded && loaded.stats],
      ['/api/v1/ever-connect/status', loaded && loaded.connect],
      ['/api/v1/ever-connect/integrations', loaded && loaded.connect],
      ['/api/v1/ever-connect/managed', loaded && loaded.connect],
    ];
    for (const [path, expected] of routes) {
      const response = await fetch(`${baseUrl}${path}`, { headers });
      await response.text();
      log?.(`${path}: ${response.status}`);
      if (loaded && response.status !== (expected ? 200 : 404)) {
        throw new Error(`${path} answered ${response.status} to the operator in ${mode}; expected ${expected ? 200 : 404}`);
      }
    }
  },

  /**
   * The operator (confirmed at sign-in) switches the statistics off on the Ever Platform page. Only while the scheduler's
   * first slot is still well ahead (its time as the API reports it): otherwise the run could not tell a send before the
   * switch-off from one after it, and it stops as a fault rather than a verdict.
   */
  async prepareLoadedOff({ baseUrl, fetch: untimed, headers, log }) {
    const fetch = timed(untimed);
    const before = await json(fetch, `${baseUrl}/api/v1/ever-stats/status`, { headers });
    const nextSendAt = before.body?.data?.nextSendAt;
    if (before.status !== 200 || typeof nextSendAt !== 'number') {
      throw new Error(`the statistics status does not name the next slot (${before.status})`);
    }
    if (nextSendAt - Date.now() < SLOT_MARGIN_MS) {
      throw new Error(`the first statistics slot is ${Math.round((nextSendAt - Date.now()) / 1000)} s away: too close to switch off first`);
    }
    log?.(`first slot in ${Math.round((nextSendAt - Date.now()) / 1000)} s`);
    const response = await fetch(`${baseUrl}/api/v1/ever-stats/enabled`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    await response.text();
    log?.(`switch off: ${response.status}`);
    if (response.status !== 200) {
      throw new Error(`the operator could not switch the statistics off (${response.status})`);
    }
    const after = await json(fetch, `${baseUrl}/api/v1/ever-stats/status`, { headers });
    if (after.body?.data?.enabled !== false) {
      throw new Error('the statistics still read as on after the switch-off');
    }
  },
};
