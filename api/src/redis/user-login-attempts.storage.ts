import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';

// Takes one attempt back, only while the count is above 0: a count reset meanwhile stays at 0, and a key that has
// expired is not created again (without an expiry). DECR keeps the expiry of the key.
const DECREMENT_ABOVE_ZERO = `
local attempts = tonumber(redis.call('GET', KEYS[1]))
if attempts and attempts > 0 then
  return redis.call('DECR', KEYS[1])
end
return attempts or 0
`;

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

  /**
   * Adds one attempt and returns the new count. Parallel calls each get a count of their own. A key created here
   * expires after ttl: a later call keeps that expiry.
   */
  async incrementUserAttempts(userKey: string, ttl: number): Promise<number> {
    if (!userKey || ttl <= 0) {
      throw new Error('Invalid input parameters');
    }
    if (this.redisClient) {
      try {
        // One transaction: SET NX creates a missing key at 0 with its expiry, then INCR adds the attempt and keeps it
        const results = await this.redisClient.multi().set(userKey, 0, 'PX', ttl, 'NX').incr(userKey).exec();
        const [failure, count] = results[1];
        if (failure) {
          throw failure;
        }
        return Number(count);
      } catch (error) {
        this.logger.error('Failed to increment user attempts in Redis:', error.message);
        throw error;
      }
    }
    const now = Date.now();
    const entry = this.inMemoryStorage.get(userKey);
    const current = entry && entry.expiry > now ? entry : { attempts: 0, expiry: now + ttl };
    this.inMemoryStorage.set(userKey, { attempts: current.attempts + 1, expiry: current.expiry });
    return current.attempts + 1;
  }

  /**
   * Takes back one attempt added by incrementUserAttempts, only while the count is above 0.
   */
  async decrementUserAttempts(userKey: string): Promise<void> {
    if (!userKey) {
      throw new Error('Invalid user key');
    }
    if (this.redisClient) {
      try {
        await this.redisClient.eval(DECREMENT_ABOVE_ZERO, 1, userKey);
      } catch (error) {
        this.logger.error('Failed to decrement user attempts in Redis:', error.message);
        throw error;
      }
      return;
    }
    const entry = this.inMemoryStorage.get(userKey);
    if (entry && entry.expiry > Date.now() && entry.attempts > 0) {
      this.inMemoryStorage.set(userKey, { attempts: entry.attempts - 1, expiry: entry.expiry });
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
