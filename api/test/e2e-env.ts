/**
 * Environment of the e2e runs, set before any suite loads the configuration (jest `setupFiles`).
 *
 * The suites sign up hundreds of accounts from one address (127.0.0.1), so the per-address sign-up limit of SaaS mode
 * (TR_SIGNUPS_PER_HOUR) is off for them unless the run sets it; its own test turns it on.
 */
process.env.TR_SIGNUPS_PER_HOUR ??= '0';

// One proxy hop, as the hosted service runs (SaaS mode logs an error at every app start without it). The tests that need
// it unset clear `config.http.trustProxy` themselves.
process.env.TR_TRUST_PROXY ??= '1';
