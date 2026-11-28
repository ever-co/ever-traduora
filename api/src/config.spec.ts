import { globalThrottle, parseCorsOrigins, parseTrustProxy, resolveSecret } from './config';

test('should refuse to run in production without a secret', () => {
  expect(() => resolveSecret(undefined, 'production')).toThrow(/TR_SECRET/);
  expect(() => resolveSecret('', 'production')).toThrow(/TR_SECRET/);
});

test('should refuse the published example secrets in every environment', () => {
  for (const secret of ['secret', 'supersecretkey', 'mysupersecret']) {
    for (const nodeEnv of ['production', 'development', 'test', undefined]) {
      expect(() => resolveSecret(secret, nodeEnv)).toThrow(/TR_SECRET/);
    }
  }
});

test('should use the configured secret', () => {
  const secret = 'a-configured-secret-'.padEnd(64, 'x');
  expect(resolveSecret(secret, 'production')).toEqual(secret);
  expect(resolveSecret(secret, 'development')).toEqual(secret);
});

test('should use a random secret outside production when none is configured', () => {
  const first = resolveSecret(undefined, 'development');
  const second = resolveSecret('', undefined);
  expect(first).toMatch(/^[0-9a-f]{64}$/);
  expect(second).toMatch(/^[0-9a-f]{64}$/);
  expect(first).not.toEqual(second);
  expect(first).not.toEqual('secret');
});

describe('P5 settings (DESIGN §3.8)', () => {
  it('reads TR_TRUST_PROXY as a hop count, a boolean or a list of proxies', () => {
    expect(parseTrustProxy(undefined)).toBeUndefined();
    expect(parseTrustProxy('  ')).toBeUndefined();
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('loopback, 10.0.0.0/8')).toEqual(['loopback', '10.0.0.0/8']);
  });

  it('limits 600 requests per minute by default in SaaS mode, nothing elsewhere, and keeps an explicit value', () => {
    expect(globalThrottle({ saas: false })).toEqual({ ttl: 0, limit: 0 });
    expect(globalThrottle({ saas: true })).toEqual({ ttl: 60000, limit: 600 });
    expect(globalThrottle({ saas: true, limit: '50' })).toEqual({ ttl: 60000, limit: 50 });
    expect(globalThrottle({ saas: true, ttl: '1000', limit: '0' })).toEqual({ ttl: 1000, limit: 0 });
    expect(globalThrottle({ saas: false, ttl: '60000', limit: '100' })).toEqual({ ttl: 60000, limit: 100 });
  });

  it('reads TR_CORS_ORIGINS as origins', () => {
    expect(parseCorsOrigins(undefined)).toEqual([]);
    expect(parseCorsOrigins('https://app.example.com/, http://localhost:4200')).toEqual(['https://app.example.com', 'http://localhost:4200']);
    expect(parseCorsOrigins('not a url')).toEqual(['not a url']);
  });
});
