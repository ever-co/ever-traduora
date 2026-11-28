import * as nock from 'nock';
import { config } from '../config';
import { TurnstileService, turnstileEnabled, turnstileSiteKey } from './turnstile.service';

describe('TurnstileService', () => {
  const saved = { turnstile: { ...config.turnstile }, saas: config.saasEnabled, virtualHost: config.virtualHost };
  const service = new TurnstileService();
  const on = () => Object.assign(config.turnstile, { siteKey: 'site-key', secretKey: 'secret-key' });
  const siteverify = () => nock('https://challenges.cloudflare.com').post('/turnstile/v0/siteverify');
  /** What Cloudflare answers for a token solved on the sign-up form of app.traduora.co */
  const passed = { success: true, action: 'signup', hostname: 'app.traduora.co' };
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return 'passed';
    } catch (error) {
      return `${error.getStatus()} ${error.code}`;
    }
  };

  beforeAll(() => nock.disableNetConnect());

  beforeEach(() => {
    config.virtualHost = 'https://app.traduora.co';
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    Object.assign(config.turnstile, saved.turnstile);
    config.saasEnabled = saved.saas;
    config.virtualHost = saved.virtualHost;
    nock.cleanAll();
    jest.restoreAllMocks();
  });

  afterAll(() => nock.enableNetConnect());

  it('is off until both keys are set, and then lets everything through without asking', async () => {
    const scope = siteverify().reply(200, { success: false });
    for (const keys of [{}, { siteKey: 'site-key' }, { secretKey: 'secret-key' }]) {
      Object.assign(config.turnstile, { siteKey: undefined, secretKey: undefined }, keys);
      expect(turnstileEnabled()).toBe(false);
      expect(turnstileSiteKey()).toBeUndefined();
      expect(await codeOf(service.assertHuman(undefined, undefined, 'signup'))).toBe('passed');
    }
    expect(scope.isDone()).toBe(false);
  });

  it('refuses a missing or oversized token without asking Cloudflare', async () => {
    on();
    const scope = siteverify().reply(200, passed);
    for (const token of [undefined, '', 42, 'x'.repeat(2049)]) {
      expect(await codeOf(service.assertHuman(token, undefined, 'signup'))).toBe('400 turnstile_failed');
    }
    expect(scope.isDone()).toBe(false);
  });

  it('asks siteverify with the secret, the token and the address, and passes a token of this form and host', async () => {
    on();
    let sent: Record<string, string>;
    siteverify().reply(function (_uri, body) {
      sent = Object.fromEntries(new URLSearchParams(body as string));
      return [200, passed];
    });
    expect(turnstileSiteKey()).toBe('site-key');
    expect(await codeOf(service.assertHuman('a-token', '203.0.113.7', 'signup'))).toBe('passed');
    expect(sent).toEqual({ secret: 'secret-key', response: 'a-token', remoteip: '203.0.113.7' });
    // The host name as Cloudflare writes it, in any case
    siteverify().reply(200, { ...passed, hostname: 'App.Traduora.co' });
    expect(await codeOf(service.assertHuman('a-token', undefined, 'signup'))).toBe('passed');
  });

  it('refuses a token Cloudflare does not confirm, whatever the answer looks like', async () => {
    on();
    for (const answer of [{ success: false, 'error-codes': ['timeout-or-duplicate'] }, { ...passed, success: 'true' }, 'not json', {}]) {
      siteverify().reply(200, answer);
      expect(await codeOf(service.assertHuman('a-token', undefined, 'signup'))).toBe('400 turnstile_failed');
    }
  });

  it('refuses a token solved on another form or another host (review of #679)', async () => {
    on();
    for (const answer of [
      { ...passed, action: 'forgot-password' },
      { ...passed, action: undefined },
      { ...passed, hostname: 'evil.example' },
      { ...passed, hostname: 'app.traduora.co.evil.example' },
      { ...passed, hostname: undefined },
    ]) {
      siteverify().reply(200, answer);
      expect([answer, await codeOf(service.assertHuman('a-token', undefined, 'signup'))]).toEqual([answer, '400 turnstile_failed']);
    }
    siteverify().reply(200, { ...passed, action: 'forgot-password' });
    expect(await codeOf(service.assertHuman('a-token', undefined, 'forgot-password'))).toBe('passed');
  });

  it('answers 503 turnstile_unavailable when Cloudflare cannot be reached', async () => {
    on();
    siteverify().replyWithError({ code: 'ETIMEDOUT' });
    expect(await codeOf(service.assertHuman('a-token', undefined, 'signup'))).toBe('503 turnstile_unavailable');
  });

  it('refuses to start in SaaS mode with only one key, and only warns elsewhere', () => {
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    for (const keys of [
      { siteKey: 'site-key', secretKey: undefined },
      { siteKey: undefined, secretKey: 'secret-key' },
    ]) {
      Object.assign(config.turnstile, keys);
      config.saasEnabled = true;
      expect(() => service.onApplicationBootstrap()).toThrow(/TR_TURNSTILE_SITE_KEY and TR_TURNSTILE_SECRET_KEY/);
      config.saasEnabled = false;
      expect(() => service.onApplicationBootstrap()).not.toThrow();
    }
    expect(warn).toHaveBeenCalledTimes(2);
    // Both or neither: nothing to say
    config.saasEnabled = true;
    on();
    service.onApplicationBootstrap();
    Object.assign(config.turnstile, { siteKey: undefined, secretKey: undefined });
    service.onApplicationBootstrap();
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
