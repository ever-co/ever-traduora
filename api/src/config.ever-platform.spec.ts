import { getStrictBoolOrDefault, isLocalHost, normalizeEmail, readEverPlatformConfig, usableEverApiUrl } from './config';

describe('Ever Platform settings', () => {
  const read = (env: Record<string, string | undefined>) => {
    const warnings: string[] = [];
    const config = readEverPlatformConfig(env, message => warnings.push(message));
    return { config, warnings };
  };

  describe('TR_EVER_STATS_ENABLED', () => {
    it('is on when unset or empty', () => {
      expect(read({}).config.statsEnabled).toBe(true);
      expect(read({ TR_EVER_STATS_ENABLED: '' }).config.statsEnabled).toBe(true);
      expect(read({}).warnings).toEqual([]);
    });

    it("is off only for exactly 'false'", () => {
      expect(read({ TR_EVER_STATS_ENABLED: 'false' }).config.statsEnabled).toBe(false);
      expect(read({ TR_EVER_STATS_ENABLED: 'true' }).config.statsEnabled).toBe(true);
    });

    it('keeps the default (on) for a malformed value and names it once', () => {
      for (const value of ['garbage', 'FALSE', '0', 'off', 'no']) {
        const { config, warnings } = read({ TR_EVER_STATS_ENABLED: value });
        expect(config.statsEnabled).toBe(true);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`TR_EVER_STATS_ENABLED is "${value}"`);
      }
    });

    it('never repeats a long or unusual value in the log', () => {
      const { warnings } = read({ TR_EVER_STATS_ENABLED: 'someone@example.test' });
      expect(warnings[0]).not.toContain('someone');
      expect(warnings[0]).toContain('an unrecognised value');
    });
  });

  describe('getStrictBoolOrDefault', () => {
    it('honours only true and false', () => {
      const seen: string[] = [];
      expect(getStrictBoolOrDefault(undefined, true, v => seen.push(v))).toBe(true);
      expect(getStrictBoolOrDefault('false', true, v => seen.push(v))).toBe(false);
      expect(getStrictBoolOrDefault('true', false, v => seen.push(v))).toBe(true);
      expect(getStrictBoolOrDefault('yes', false, v => seen.push(v))).toBe(false);
      expect(seen).toEqual(['yes']);
    });
  });

  describe('TR_EVER_STATS_COUNTRY', () => {
    it('is ZZ when not declared', () => {
      expect(read({}).config.statsCountry).toBe('ZZ');
    });

    it('is upper-cased', () => {
      expect(read({ TR_EVER_STATS_COUNTRY: 'de' }).config.statsCountry).toBe('DE');
    });

    it('falls back to ZZ for anything but two letters, with one warning', () => {
      for (const value of ['Germany', 'D', 'D1', 'DEU']) {
        const { config, warnings } = read({ TR_EVER_STATS_COUNTRY: value });
        expect(config.statsCountry).toBe('ZZ');
        expect(warnings).toHaveLength(1);
      }
    });
  });

  describe('TR_EVER_ADMIN_EMAILS', () => {
    it('defaults to TR_ADMIN_EMAIL, lower-cased', () => {
      expect(read({ TR_ADMIN_EMAIL: ' Admin@Example.TEST ' }).config.adminEmails).toEqual(['admin@example.test']);
    });

    it('defaults to the seeded admin when neither is set', () => {
      expect(read({}).config.adminEmails).toEqual(['local.admin@ever.co']);
    });

    it('takes a comma-separated list over TR_ADMIN_EMAIL', () => {
      expect(
        read({ TR_ADMIN_EMAIL: 'admin@example.test', TR_EVER_ADMIN_EMAILS: 'Ops@Example.test, second@example.test,' }).config.adminEmails,
      ).toEqual(['ops@example.test', 'second@example.test']);
    });

    it('normalizes e-mail addresses', () => {
      expect(normalizeEmail('  Someone@Example.TEST ')).toBe('someone@example.test');
    });
  });

  describe('TR_EVER_INSTALL_SOURCE', () => {
    it('is self-hosted when unset', () => {
      expect(read({}).config.installSource).toBe('self-hosted');
    });

    it('accepts the declared values', () => {
      for (const value of ['cloud', 'self-hosted', 'ever.sh', 'works_app', 'desktop', 'partner:acme-hosting']) {
        expect(read({ TR_EVER_INSTALL_SOURCE: value }).config.installSource).toBe(value);
      }
    });

    it('falls back to self-hosted for anything else, with one warning', () => {
      for (const value of ['Cloud', 'saas', 'partner:A', 'partner:x']) {
        const { config, warnings } = read({ TR_EVER_INSTALL_SOURCE: value });
        expect(config.installSource).toBe('self-hosted');
        expect(warnings).toHaveLength(1);
      }
    });
  });

  describe('destination', () => {
    it('defaults to the Ever Platform API', () => {
      expect(read({}).config.statsApiUrl).toBe('https://api.ever.co');
      expect(read({}).config.apiUrl).toBe('https://api.ever.co');
    });

    it('follows TR_EVER_PLATFORM_API_URL, then TR_EVER_STATS_API_URL', () => {
      expect(read({ TR_EVER_PLATFORM_API_URL: 'https://platform.example.test/' }).config.statsApiUrl).toBe('https://platform.example.test');
      expect(
        read({ TR_EVER_PLATFORM_API_URL: 'https://platform.example.test', TR_EVER_STATS_API_URL: 'https://stats.example.test' }).config.statsApiUrl,
      ).toBe('https://stats.example.test');
    });

    it('accepts plain http for a local destination only', () => {
      for (const url of ['http://localhost:8080', 'http://127.0.0.1:9', 'http://10.231.7.252:8080', 'http://mock-platform:8080']) {
        expect(read({ TR_EVER_STATS_API_URL: url }).config.statsApiUrl).toBe(url);
      }
    });

    it('sends nothing to an insecure or malformed destination, and says so', () => {
      for (const url of ['http://example.com', 'http://metadata', 'not a url', 'https://user:pw@example.com', 'https://example.com/?a=1']) {
        const { config, warnings } = read({ TR_EVER_STATS_API_URL: url });
        expect(config.statsApiUrl).toBeNull();
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('ever_stats.url_insecure');
        expect(warnings[0]).not.toContain(url);
      }
    });

    it('recognises local hosts', () => {
      expect(isLocalHost('localhost')).toBe(true);
      expect(isLocalHost('[::1]')).toBe(true);
      expect(isLocalHost('172.16.0.1')).toBe(true);
      expect(isLocalHost('172.32.0.1')).toBe(false);
      expect(isLocalHost('api.ever.co')).toBe(false);
      expect(isLocalHost('8.8.8.8')).toBe(false);
      expect(usableEverApiUrl('https://api.ever.co/')).toBe('https://api.ever.co');
    });
  });

  describe('TR_EVER_STATS_SEND_INTERVAL_S', () => {
    it('is a day by default', () => {
      expect(read({}).config.statsSendIntervalS).toBe(86400);
    });

    it('accepts a short interval for a local destination (tests)', () => {
      expect(read({ TR_EVER_STATS_API_URL: 'http://mock-platform:8080', TR_EVER_STATS_SEND_INTERVAL_S: '5' }).config.statsSendIntervalS).toBe(5);
    });

    it('refuses a short interval towards a public destination', () => {
      const { config, warnings } = read({ TR_EVER_STATS_SEND_INTERVAL_S: '5' });
      expect(config.statsSendIntervalS).toBe(86400);
      expect(warnings).toHaveLength(1);
      expect(read({ TR_EVER_STATS_SEND_INTERVAL_S: '3600' }).config.statsSendIntervalS).toBe(3600);
    });

    it('refuses a value that is not a whole number of seconds', () => {
      for (const value of ['abc', '1.5', '-1', '0', '999999999']) {
        expect(read({ TR_EVER_STATS_API_URL: 'http://localhost:1', TR_EVER_STATS_SEND_INTERVAL_S: value }).config.statsSendIntervalS).toBe(86400);
      }
    });
  });

  it('knows whether TR_SECRET is set', () => {
    expect(read({}).config.secretConfigured).toBe(false);
    expect(read({ TR_SECRET: 'a'.repeat(64) }).config.secretConfigured).toBe(true);
  });
});
