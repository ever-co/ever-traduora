import * as nock from 'nock';
import { config } from '../config';
import { TurnstileService, turnstileEnabled, turnstileSiteKey } from './turnstile.service';

describe('TurnstileService', () => {
  const saved = { ...config.turnstile };
  const service = new TurnstileService();
  const on = () => Object.assign(config.turnstile, { siteKey: 'site-key', secretKey: 'secret-key' });
  const codeOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
      return 'passed';
    } catch (error) {
      return `${error.getStatus()} ${error.code}`;
    }
  };

  beforeAll(() => {
    nock.disableNetConnect();
  });

  afterEach(() => {
    Object.assign(config.turnstile, saved);
    nock.cleanAll();
    jest.restoreAllMocks();
  });

  afterAll(() => nock.enableNetConnect());

  it('is off until both keys are set, and then lets everything through without asking', async () => {
    const scope = nock('https://challenges.cloudflare.com').post('/turnstile/v0/siteverify').reply(200, { success: false });
    for (const keys of [{}, { siteKey: 'site-key' }, { secretKey: 'secret-key' }]) {
      Object.assign(config.turnstile, { siteKey: undefined, secretKey: undefined }, keys);
      expect(turnstileEnabled()).toBe(false);
      expect(turnstileSiteKey()).toBeUndefined();
      expect(await codeOf(service.assertHuman(undefined))).toBe('passed');
    }
    expect(scope.isDone()).toBe(false);
  });

  it('refuses a missing or oversized token without asking Cloudflare', async () => {
    on();
    const scope = nock('https://challenges.cloudflare.com').post('/turnstile/v0/siteverify').reply(200, { success: true });
    for (const token of [undefined, '', 42, 'x'.repeat(2049)]) {
      expect(await codeOf(service.assertHuman(token))).toBe('400 turnstile_failed');
    }
    expect(scope.isDone()).toBe(false);
  });

  it('asks siteverify with the secret, the token and the address, and passes on success', async () => {
    on();
    let sent: Record<string, string>;
    nock('https://challenges.cloudflare.com')
      .post('/turnstile/v0/siteverify', body => {
        sent = body;
        return true;
      })
      .reply(200, { success: true, hostname: 'app.traduora.co' });
    expect(turnstileSiteKey()).toBe('site-key');
    expect(await codeOf(service.assertHuman('a-token', '203.0.113.7'))).toBe('passed');
    expect(sent).toEqual({ secret: 'secret-key', response: 'a-token', remoteip: '203.0.113.7' });
  });

  it('refuses a token Cloudflare does not confirm, whatever the answer looks like', async () => {
    on();
    jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    for (const answer of [{ success: false, 'error-codes': ['timeout-or-duplicate'] }, { success: 'true' }, 'not json', {}]) {
      nock('https://challenges.cloudflare.com').post('/turnstile/v0/siteverify').reply(200, answer);
      expect(await codeOf(service.assertHuman('a-token'))).toBe('400 turnstile_failed');
    }
    nock('https://challenges.cloudflare.com').post('/turnstile/v0/siteverify').reply(500, { success: true, oops: 1 });
    // A 500 that says success is odd, but it is what Cloudflare said: only `success: true` passes
    expect(await codeOf(service.assertHuman('a-token'))).toBe('passed');
  });

  it('answers 503 turnstile_unavailable when Cloudflare cannot be reached', async () => {
    on();
    jest.spyOn((service as any).logger, 'error').mockImplementation(() => undefined);
    nock('https://challenges.cloudflare.com').post('/turnstile/v0/siteverify').replyWithError({ code: 'ETIMEDOUT' });
    expect(await codeOf(service.assertHuman('a-token'))).toBe('503 turnstile_unavailable');
  });

  it('warns at boot when only one key is set', () => {
    const warn = jest.spyOn((service as any).logger, 'warn').mockImplementation(() => undefined);
    Object.assign(config.turnstile, { siteKey: 'site-key', secretKey: undefined });
    service.onApplicationBootstrap();
    expect(warn).toHaveBeenCalledTimes(1);
    on();
    service.onApplicationBootstrap();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
