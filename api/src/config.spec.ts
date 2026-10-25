import { resolveSecret } from './config';

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
