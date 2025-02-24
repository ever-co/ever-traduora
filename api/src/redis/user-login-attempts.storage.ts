import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class UserLoginAttemptsStorage {
  private readonly logger = new Logger(UserLoginAttemptsStorage.name);
  private inMemoryStorage: Map<string, { attempts: number; expiry: number }> = new Map();

  constructor(@Inject('REDIS_CLIENT') private readonly redisClient?: Redis) {
    if (!this.redisClient) {
      this.logger.warn('Redis client is not initialized. Using in-memory storage.');
      // Set up periodic cleanup every 5 minutes
      setInterval(() => this.cleanupExpiredEntries(), 5 * 60 * 1000);
    }
  }

  async setUserAttempts(userKey: string, userAttempt: number, ttl: number): Promise<void> {
    if (this.redisClient) {
      try {
        await this.redisClient.set(userKey, userAttempt, 'EX', ttl);
      } catch (error) {
        this.logger.error('Failed to set user attempts in Redis:', error.message);
        throw error;
      }
    } else {
      const expiry = Date.now() + ttl * 1000;
      this.inMemoryStorage.set(userKey, { attempts: userAttempt, expiry });
    }
  }

  async getUserAttempts(userKey: string): Promise<number> {
    if (this.redisClient) {
      try {
        const attempts = await this.redisClient.get(userKey);
        return attempts ? parseInt(attempts, 10) : 0;
      } catch (error) {
        this.logger.error('Failed to get user attempts from Redis:', error.message);
        throw error;
      }
    } else {
      const entry = this.inMemoryStorage.get(userKey);
      if (entry && entry.expiry > Date.now()) {
        return entry.attempts;
      }
      // Remove expired entries
      this.inMemoryStorage.delete(userKey);
      return 0;
    }
  }

  public getRedisClient(): Redis {
    return this.redisClient;
  }

  private cleanupExpiredEntries(): void {
    const now = Date.now();
    for (const [key, value] of this.inMemoryStorage.entries()) {
      if (value.expiry <= now) {
        this.inMemoryStorage.delete(key);
      }
    }
  }
}
