import { isLocalHost, normalizeEmail, parseEmailList, readApiUrl, readEverPlatformConfig, readInstallSource, readStrictBool } from './env';

describe('Ever Platform settings', () => {
  const read = (env: Record<string, string | undefined>) => {
    const warnings: string[] = [];
    const settings = readEverPlatformConfig(env, message => warnings.push(message));
    return { settings, warnings };
  };

  describe('TR_EVER_STATS_ENABLED', () => {
    it('is on when unset or empty, without a warning', () => {
      for (const env of [{}, { TR_EVER_STATS_ENABLED: '' }]) {
        const { settings, warnings } = read(env);
        expect(settings.statsEnabled).toBe(true);
        expect(warnings).toEqual([]);
      }
    });

    it('is off only for the exact value false', () => {
      expect(read({ TR_EVER_STATS_ENABLED: 'false' }).settings.statsEnabled).toBe(false);
      expect(read({ TR_EVER_STATS_ENABLED: 'true' }).settings.statsEnabled).toBe(true);
    });

    it('keeps the default (on) for a malformed value and names it once', () => {
      for (const value of ['FALSE', 'False', '0', 'no', 'off', 'garbage']) {
        const { settings, warnings } = read({ TR_EVER_STATS_ENABLED: value });
        expect(settings.statsEnabled).toBe(true);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('TR_EVER_STATS_ENABLED');
        expect(warnings[0]).toContain(`"${value}"`);
        expect(warnings[0]).toContain('default (on)');
      }
    });

    it('shows the spaces around an otherwise plain value, so "false " is seen not to be false', () => {
      const { settings, warnings } = read({ TR_EVER_STATS_ENABLED: 'false ' });
      expect(settings.statsEnabled).toBe(true);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('"false "');
      expect(read({ TR_EVER_STATS_ENABLED: 'false.' }).warnings[0]).toContain('"false."');
    });

    it('never repeats a long value in a warning', () => {
      const warnings: string[] = [];
      readStrictBool('X', false, { X: 'someone@example.com' }, message => warnings.push(message));
      expect(warnings[0]).not.toContain('someone@example.com');
    });
  });

  it('reports nothing about the other settings while the statistics are off', () => {
    const { warnings } = read({ TR_EVER_STATS_ENABLED: 'false', TR_EVER_STATS_COUNTRY: 'Germany', TR_EVER_STATS_API_URL: 'http://example.com' });
    expect(warnings).toEqual([]);
  });

  it('reports a malformed statistics setting while the statistics are on by default', () => {
    const { warnings } = read({ TR_EVER_STATS_COUNTRY: 'Germany' });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('TR_EVER_STATS_COUNTRY');
  });

  describe('TR_EVER_CONNECT_*', () => {
    it('loads the connection only for the exact value true', () => {
      expect(read({}).settings.connectEnabled).toBe(false);
      expect(read({ TR_EVER_CONNECT_ENABLED: 'false' }).settings.connectEnabled).toBe(false);
      expect(read({ TR_EVER_CONNECT_ENABLED: 'garbage' }).settings.connectEnabled).toBe(false);
      expect(read({ TR_EVER_CONNECT_ENABLED: 'true' }).settings.connectEnabled).toBe(true);
    });

    it('reads the feed mode, the deny list and the boot code', () => {
      const { settings, warnings } = read({
        TR_EVER_CONNECT_ENABLED: 'true',
        TR_EVER_CONNECT_FEED_MODE: 'bogus',
        TR_EVER_CONNECT_INTEGRATIONS_DENY: ' Stats_Link, ,instance_url,stats_link ',
        TR_EVER_CONNECT_CODE: ' EVC-TEST-0000-0001 ',
      });
      expect(settings.connectFeedMode).toBe('longpoll');
      expect(warnings.some(w => w.includes('TR_EVER_CONNECT_FEED_MODE'))).toBe(true);
      expect(settings.connectIntegrationsDeny).toEqual(['stats_link', 'instance_url']);
      expect(settings.connectCode).toBe('EVC-TEST-0000-0001');
      expect(read({ TR_EVER_CONNECT_FEED_MODE: 'interval' }).settings.connectFeedMode).toBe('interval');
    });
  });

  describe('TR_EVER_STATS_COUNTRY', () => {
    it('is ZZ when unset', () => {
      expect(read({}).settings.statsCountry).toBe('ZZ');
    });

    it('is upper-cased when it is two letters', () => {
      expect(read({ TR_EVER_STATS_ENABLED: 'true', TR_EVER_STATS_COUNTRY: 'de' }).settings.statsCountry).toBe('DE');
    });

    it('falls back to ZZ with a warning otherwise', () => {
      const { settings, warnings } = read({ TR_EVER_STATS_ENABLED: 'true', TR_EVER_STATS_COUNTRY: 'Germany' });
      expect(settings.statsCountry).toBe('ZZ');
      expect(warnings.some(w => w.includes('TR_EVER_STATS_COUNTRY'))).toBe(true);
    });
  });

  describe('addresses', () => {
    it('default to https://api.ever.co', () => {
      const { settings } = read({});
      expect(settings.apiUrl).toBe('https://api.ever.co');
      expect(settings.statsApiUrl).toBe('https://api.ever.co');
    });

    it('take TR_EVER_STATS_API_URL first, then TR_EVER_PLATFORM_API_URL', () => {
      expect(read({ TR_EVER_PLATFORM_API_URL: 'https://api-stage.ever.co/' }).settings.statsApiUrl).toBe('https://api-stage.ever.co');
      expect(read({ TR_EVER_PLATFORM_API_URL: 'https://a.example', TR_EVER_STATS_API_URL: 'http://mock-platform:8080' }).settings.statsApiUrl).toBe(
        'http://mock-platform:8080',
      );
    });

    it('refuse plain http to a public host, credentials, queries and fragments', () => {
      const warn = () => undefined;
      expect(readApiUrl(['U'], 'https://d', { U: 'http://example.com' }, warn)).toBeNull();
      expect(readApiUrl(['U'], 'https://d', { U: 'https://user:pass@example.com' }, warn)).toBeNull();
      expect(readApiUrl(['U'], 'https://d', { U: 'https://example.com/?a=1' }, warn)).toBeNull();
      expect(readApiUrl(['U'], 'https://d', { U: 'https://example.com/#a' }, warn)).toBeNull();
      expect(readApiUrl(['U'], 'https://d', { U: 'not a url' }, warn)).toBeNull();
    });

    it('allow plain http to loopback, private addresses and container names only', () => {
      expect(isLocalHost('localhost')).toBe(true);
      expect(isLocalHost('127.0.0.1')).toBe(true);
      expect(isLocalHost('10.1.2.3')).toBe(true);
      expect(isLocalHost('172.20.0.5')).toBe(true);
      expect(isLocalHost('192.168.1.1')).toBe(true);
      expect(isLocalHost('mock-platform')).toBe(true);
      expect(isLocalHost('metadata')).toBe(false);
      expect(isLocalHost('example.com')).toBe(false);
      expect(isLocalHost('8.8.8.8')).toBe(false);
      expect(isLocalHost('10.example.com')).toBe(false);
      expect(isLocalHost('192.168.example.com')).toBe(false);
    });
  });

  describe('TR_EVER_STATS_SEND_INTERVAL_S', () => {
    it('is a day by default', () => {
      expect(read({}).settings.statsSendIntervalS).toBe(86400);
    });

    it('accepts a short interval only for a local destination', () => {
      expect(
        read({ TR_EVER_STATS_ENABLED: 'true', TR_EVER_STATS_API_URL: 'http://mock-platform:8080', TR_EVER_STATS_SEND_INTERVAL_S: '5' }).settings
          .statsSendIntervalS,
      ).toBe(5);
      expect(read({ TR_EVER_STATS_ENABLED: 'true', TR_EVER_STATS_SEND_INTERVAL_S: '5' }).settings.statsSendIntervalS).toBe(86400);
      expect(read({ TR_EVER_STATS_ENABLED: 'true', TR_EVER_STATS_SEND_INTERVAL_S: '7200' }).settings.statsSendIntervalS).toBe(7200);
    });
  });

  describe('TR_EVER_INSTALL_SOURCE', () => {
    it('is self-hosted unless declared', () => {
      expect(readInstallSource({})).toBe('self-hosted');
      expect(readInstallSource({ TR_EVER_INSTALL_SOURCE: 'cloud' })).toBe('cloud');
      expect(readInstallSource({ TR_EVER_INSTALL_SOURCE: 'partner:acme-1' })).toBe('partner:acme-1');
      expect(readInstallSource({ TR_EVER_INSTALL_SOURCE: 'something' }, () => undefined)).toBe('self-hosted');
    });
  });

  describe('operators', () => {
    it('default to TR_ADMIN_EMAIL, lower-cased', () => {
      expect(read({ TR_ADMIN_EMAIL: ' Admin@Example.COM ' }).settings.adminEmails).toEqual(['admin@example.com']);
    });

    it('fall back to the built-in admin e-mail', () => {
      expect(read({}).settings.adminEmails).toEqual(['local.admin@ever.co']);
    });

    it('are the list of TR_EVER_ADMIN_EMAILS when set', () => {
      expect(
        read({ TR_ADMIN_EMAIL: 'admin@example.com', TR_EVER_ADMIN_EMAILS: 'Ops@Example.com, second@example.com,,ops@example.com' }).settings
          .adminEmails,
      ).toEqual(['ops@example.com', 'second@example.com']);
    });

    it('normalize e-mails', () => {
      expect(normalizeEmail('  A@B.C ')).toBe('a@b.c');
      expect(normalizeEmail(undefined)).toBe('');
      expect(parseEmailList('not-an-email, x@y.z')).toEqual(['x@y.z']);
    });
  });
});
