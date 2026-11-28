import { Logger } from '@nestjs/common';
import { redisOptions } from './redis.module';

describe('redisOptions', () => {
  const settings = (values: Record<string, string | undefined>) => ({ get: (key: string) => values[key] }) as any;

  afterEach(() => jest.restoreAllMocks());

  it('needs a host and a port', () => {
    expect(redisOptions(settings({}))).toBeUndefined();
    expect(redisOptions(settings({ REDIS_HOST: 'valkey' }))).toBeUndefined();
  });

  it('uses database 0 unless REDIS_DB names another index', () => {
    expect(redisOptions(settings({ REDIS_HOST: 'valkey', REDIS_PORT: '6379', REDIS_PASSWORD: 'p' }))).toEqual({
      host: 'valkey',
      port: '6379',
      password: 'p',
      db: 0,
    });
    expect(redisOptions(settings({ REDIS_HOST: 'valkey', REDIS_PORT: '6379', REDIS_DB: '5' })).db).toBe(5);
  });

  it('falls back to 0, with a warning, for a REDIS_DB that is no index', () => {
    const warn = jest.spyOn(Logger, 'warn').mockImplementation(() => undefined);
    expect(redisOptions(settings({ REDIS_HOST: 'valkey', REDIS_PORT: '6379', REDIS_DB: 'two' })).db).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
