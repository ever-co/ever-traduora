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
    if (!userKey || userAttempt < 0 || ttl <= 0) {
      throw new Error('Invalid input parameters');
    }
    if (this.redisClient) {
      try {
        await this.redisClient.set(userKey, userAttempt, 'PX', ttl);
      } catch (error) {
        this.logger.error('Failed to set user attempts in Redis:', error.message);
        throw error;
      }
    } else {
      try {
        const expiry = Date.now() + ttl;
        this.inMemoryStorage.set(userKey, { attempts: userAttempt, expiry });
      } catch (error) {
        this.logger.error('Failed to set user attempts in memory:', error.message);
        throw error;
      }
    }
  }

  async getUserAttempts(userKey: string): Promise<number> {
    if (!userKey) {
      throw new Error('Invalid user key');
    }
    if (this.redisClient) {
      try {
        const attempts = await this.redisClient.get(userKey);
        const parsedAttempts = attempts ? Number(attempts) : 0;
        if (isNaN(parsedAttempts)) {
          throw new Error('Invalid attempts value in Redis');
        }
        return parsedAttempts;
      } catch (error) {
        this.logger.error('Failed to get user attempts from Redis:', error.message);
        throw error;
      }
    } else {
      try {
        const entry = this.inMemoryStorage.get(userKey);
        if (entry && entry.expiry > Date.now()) {
          return entry.attempts;
        }
        // Remove expired entries
        this.inMemoryStorage.delete(userKey);
        return 0;
      } catch (error) {
        this.logger.error('Failed to get user attempts from memory:', error.message);
        throw error;
      }
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
