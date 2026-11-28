import { Module, Global, Logger } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { ConfigService } from '@nestjs/config';

/**
 * The client options from REDIS_HOST, REDIS_PORT, REDIS_PASSWORD and REDIS_DB (the database index, 0 by default, so a
 * shared server can keep Traduora's keys apart from another app's), or `undefined` without a host and port.
 */
export function redisOptions(configService: Pick<ConfigService, 'get'>): RedisOptions | undefined {
  const host = configService.get<string>('REDIS_HOST');
  const port = configService.get<number>('REDIS_PORT');
  if (!host || !port) {
    return undefined;
  }
  const rawDb = `${configService.get<string>('REDIS_DB') ?? ''}`.trim();
  const db = /^\d+$/.test(rawDb) ? Number(rawDb) : 0;
  if (rawDb && !/^\d+$/.test(rawDb)) {
    Logger.warn(`REDIS_DB must be a database index (0, 1, ...): using 0 instead of '${rawDb}'`);
  }
  return { host, port, password: configService.get<string>('REDIS_PASSWORD'), db };
}

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const options = redisOptions(configService);
        if (!options) {
          Logger.warn('Redis configuration is missing. Redis will not be initialized.');
          return null;
        }
        try {
          return new Redis(options);
        } catch (error) {
          Logger.error('Failed to initialize Redis client:', error.message);
          return null;
        }
      },
      inject: [ConfigService],
    },
  ],
  exports: ['REDIS_CLIENT'],
})
export class RedisModule {}
