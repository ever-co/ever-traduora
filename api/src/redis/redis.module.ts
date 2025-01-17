import { Module, Global, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  providers: [
    {
      provide: 'REDIS_CLIENT',
      useFactory: (configService: ConfigService) => {
        const redisHost = configService.get<string>('REDIS_HOST');
        const redisPort = configService.get<number>('REDIS_PORT');
        const redisPassword = configService.get<string>('REDIS_PASSWORD');

        if (!redisHost || !redisPort) {
          Logger.warn('Redis configuration is missing. Redis will not be initialized.');
          return null;
        }
        try {
          return new Redis({
            host: redisHost,
            port: redisPort,
            password: redisPassword,
          });
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
