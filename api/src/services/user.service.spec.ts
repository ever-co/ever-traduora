import { UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import Redis from 'ioredis';
import { FindOperator, Repository } from 'typeorm';
import { config } from '../config';
import { GrantType } from '../domain/http';
import { User } from '../entity/user.entity';
import { TooManyRequestsException } from '../errors';
import { UserLoginAttemptsStorage } from '../redis/user-login-attempts.storage';
import * as publishedPasswords from '../utils/published-passwords';
import { UserService } from './user.service';

// The operators UserService puts in its where clauses
const matches = (value: any, condition: any): boolean => {
  if (condition instanceof FindOperator) {
    switch (condition.type) {
      case 'isNull':
        return value === null || value === undefined;
      case 'lessThan':
        return value !== null && value !== undefined && value < condition.value;
      case 'moreThan':
        return value !== null && value !== undefined && value > condition.value;
      case 'or':
        return (condition.value as unknown as FindOperator<any>[]).some(child => matches(value, child));
      default:
        throw new Error(`operator ${condition.type} is not supported by this mock`);
    }
  }
  return value === condition;
};

// One stored row: the service gets copies, as from a database. Each call reads and writes the row at once, as one
// statement does.
class InMemoryUserRepository {
  constructor(public row: User) {}

  private matchesRow(where: Partial<Record<keyof User, any>>): boolean {
    return Object.entries(where).every(([column, condition]) => matches(this.row[column], condition));
  }

  async findOneBy(where: Partial<Record<keyof User, any>>): Promise<User | null> {
    return this.matchesRow(where) ? { ...this.row } : null;
  }

  async update(where: Partial<Record<keyof User, any>>, changes: Partial<User>): Promise<{ affected: number }> {
    if (!this.matchesRow(where)) {
      return { affected: 0 };
    }
    this.row = { ...this.row, ...changes };
    return { affected: 1 };
  }

  async increment(where: Partial<Record<keyof User, any>>, column: keyof User, value: number): Promise<{ affected: number }> {
    if (!this.matchesRow(where)) {
      return { affected: 0 };
    }
    this.row = { ...this.row, [column]: (this.row[column] as number) + value };
    return { affected: 1 };
  }

  async decrement(where: Partial<Record<keyof User, any>>, column: keyof User, value: number): Promise<{ affected: number }> {
    return this.increment(where, column, -value);
  }
}

// The Redis commands UserLoginAttemptsStorage sends, on a map with a clock of its own. Each command, and each MULTI as
// a whole, runs at once, as in Redis.
class FakeRedis {
  private clock = 0;
  private readonly entries = new Map<string, { value: number; expiresAt?: number }>();

  // Moves the clock on: the keys whose expiry has come are gone
  advance(milliseconds: number): void {
    this.clock += milliseconds;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= this.clock) {
        this.entries.delete(key);
      }
    }
  }

  value(key: string): number | undefined {
    return this.entries.get(key)?.value;
  }

  // Milliseconds until the key expires
  expiresIn(key: string): number | undefined {
    const expiresAt = this.entries.get(key)?.expiresAt;
    return expiresAt === undefined ? undefined : expiresAt - this.clock;
  }

  private setNow(key: string, value: number | string, options: (string | number)[]): 'OK' | null {
    if (options.includes('NX') && this.entries.has(key)) {
      return null;
    }
    // Like SET in Redis, a SET without PX leaves the key without an expiry
    const px = options.indexOf('PX');
    this.entries.set(key, { value: Number(value), expiresAt: px >= 0 ? this.clock + Number(options[px + 1]) : undefined });
    return 'OK';
  }

  // Like INCR and DECR in Redis: a missing key is created without an expiry, an existing one keeps its expiry
  private addNow(key: string, by: number): number {
    const entry = this.entries.get(key) ?? { value: 0 };
    entry.value += by;
    this.entries.set(key, entry);
    return entry.value;
  }

  async get(key: string): Promise<string | null> {
    return this.entries.has(key) ? String(this.entries.get(key).value) : null;
  }

  async set(key: string, value: number | string, ...options: (string | number)[]): Promise<'OK' | null> {
    return this.setNow(key, value, options);
  }

  // Stands in for the one script UserLoginAttemptsStorage runs, the one of decrementUserAttempts: DECR while the count
  // is above 0
  async eval(_script: string, _numberOfKeys: number, key: string): Promise<number> {
    const value = this.value(key);
    return value !== undefined && value > 0 ? this.addNow(key, -1) : (value ?? 0);
  }

  multi() {
    const commands: (() => unknown)[] = [];
    const transaction = {
      set: (key: string, value: number | string, ...options: (string | number)[]) => {
        commands.push(() => this.setNow(key, value, options));
        return transaction;
      },
      incr: (key: string) => {
        commands.push(() => this.addNow(key, 1));
        return transaction;
      },
      exec: async (): Promise<[Error | null, unknown][]> => commands.map(command => [null, command()]),
    };
    return transaction;
  }
}

const email = 'login-attempts@example.test';
const password = 'my-right-password-t2538';
// Stands in for a published password such as the former default admin one, so this file does not contain it
const publishedPassword = 'a-password-everyone-knows-t2597';
const twentyMinutesAgo = () => new Date(Date.now() - 20 * 60 * 1000);

const newUser = async (changes: Partial<User> = {}): Promise<User> =>
  ({
    id: 'user-1',
    name: 'Login Attempts',
    email,
    encryptedPassword: Buffer.from(await bcrypt.hash(password, 4), 'utf-8'),
    loginAttempts: 0,
    lastLogin: twentyMinutesAgo(),
    ...changes,
  }) as User;

// Runs an action while a sign-in checks its password, as a request made at the same time would
const duringPasswordCheck = (action: () => unknown) => {
  const compare = bcrypt.compare;
  jest.spyOn(bcrypt, 'compare').mockImplementation((async (data: string, encrypted: string) => {
    await action();
    return compare(data, encrypted);
  }) as any);
};

// Checking a password takes a while, so that parallel sign-ins have all started before the first one is checked
const slowPasswordCheck = () => duringPasswordCheck(() => new Promise(resolve => setTimeout(resolve, 50)));

// The HTTP status of each sign-in, sorted
const statusesOf = async (signIns: Promise<User>[]): Promise<number[]> =>
  (await Promise.allSettled(signIns)).map(result => (result.status === 'fulfilled' ? 200 : result.reason.getStatus())).sort();

describe('UserService', () => {
  let users: InMemoryUserRepository;
  let service: UserService;

  const signIn = (attempt: string) => service.authenticate({ grantType: GrantType.Password, email, password: attempt });

  beforeEach(() => {
    jest.spyOn(publishedPasswords, 'isPublishedPassword').mockImplementation(attempt => attempt === publishedPassword);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('authenticate without Redis', () => {
    beforeEach(async () => {
      users = new InMemoryUserRepository(await newUser({ loginAttempts: 5 }));
      // Without REDIS_HOST and REDIS_PORT there is no Redis client: the count is the one stored on the user
      const loginAttemptsStorage = { getRedisClient: () => null } as unknown as UserLoginAttemptsStorage;
      service = new UserService(users as unknown as Repository<User>, loginAttemptsStorage);
    });

    it('counts a failed sign-in from zero once the 15 minutes have passed', async () => {
      await expect(signIn('a-wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);

      expect(users.row.loginAttempts).toBe(1);
    });

    it('lets the right password in after one failed sign-in past the window', async () => {
      await expect(signIn('a-wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);

      const user = await signIn(password);
      expect(user.id).toBe('user-1');
      expect(users.row.loginAttempts).toBe(0);
    });

    it('keeps the count of a failed sign-in made after the user was read', async () => {
      // Read before another failed sign-in stored a count of 2 and moved lastLogin to now
      const staleUser = { ...users.row };
      users.row = { ...users.row, loginAttempts: 2, lastLogin: new Date() };
      jest.spyOn(users, 'findOneBy').mockResolvedValueOnce(staleUser);

      await expect(signIn('a-wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);

      expect(users.row.loginAttempts).toBe(3);
    });

    it('still locks the account within the window', async () => {
      const lastLogin = new Date(Date.now() - 60 * 1000);
      users.row = { ...users.row, loginAttempts: 3, lastLogin };

      await expect(signIn(password)).rejects.toBeInstanceOf(TooManyRequestsException);
      // The refused attempt moves lastLogin, and the count stays at the maximum
      expect(users.row.lastLogin.getTime()).toBeGreaterThan(lastLogin.getTime());
      expect(users.row.loginAttempts).toBe(3);
    });

    it('checks no more parallel wrong passwords than the maximum', async () => {
      slowPasswordCheck();

      const statuses = await statusesOf(Array.from({ length: 5 }, () => signIn('a-wrong-password')));

      expect(statuses).toEqual([401, 401, 401, 429, 429]);
      expect(bcrypt.compare).toHaveBeenCalledTimes(3);
      expect(users.row.loginAttempts).toBe(3);
    });

    it('counts a sign-in to an account without a password, as before', async () => {
      users.row = { ...users.row, encryptedPassword: null, loginAttempts: 1, lastLogin: new Date() };

      await expect(signIn(password)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(users.row.loginAttempts).toBe(2);
    });

    it('does not count a sign-in with a published password, as before', async () => {
      const encryptedPassword = Buffer.from(await bcrypt.hash(publishedPassword, 4), 'utf-8');
      users.row = { ...users.row, encryptedPassword, loginAttempts: 1, lastLogin: new Date() };

      await expect(signIn(publishedPassword)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(users.row.encryptedPassword).toBeNull();
      expect(users.row.loginAttempts).toBe(1);
    });

    it('takes the attempt of a published password back no lower than 0', async () => {
      const encryptedPassword = Buffer.from(await bcrypt.hash(publishedPassword, 4), 'utf-8');
      users.row = { ...users.row, encryptedPassword, loginAttempts: 0, lastLogin: new Date() };
      // A sign-in with the right password resets the count meanwhile
      duringPasswordCheck(() => (users.row = { ...users.row, loginAttempts: 0 }));

      await expect(signIn(publishedPassword)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(users.row.loginAttempts).toBe(0);
    });
  });

  describe('authenticate with Redis', () => {
    const userKey = 'user-user-1';
    let redis: FakeRedis;

    beforeEach(async () => {
      users = new InMemoryUserRepository(await newUser());
      redis = new FakeRedis();
      const loginAttemptsStorage = new UserLoginAttemptsStorage(redis as unknown as Redis);
      service = new UserService(users as unknown as Repository<User>, loginAttemptsStorage);
    });

    it('checks no more parallel wrong passwords than the maximum', async () => {
      slowPasswordCheck();

      const statuses = await statusesOf(Array.from({ length: 5 }, () => signIn('a-wrong-password')));

      expect(statuses).toEqual([401, 401, 401, 429, 429]);
      expect(bcrypt.compare).toHaveBeenCalledTimes(3);
      expect(redis.value(userKey)).toBe(5);
      expect(redis.expiresIn(userKey)).toBe(config.loginAttempts.ttl);
    });

    it('unlocks once the count expires, which later attempts do not postpone', async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        await expect(signIn('a-wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
      }

      redis.advance(config.loginAttempts.ttl - 1);
      await expect(signIn(password)).rejects.toBeInstanceOf(TooManyRequestsException);
      expect(redis.expiresIn(userKey)).toBe(1);

      redis.advance(1);
      const user = await signIn(password);
      expect(user.id).toBe('user-1');
    });

    it('refuses the right password once the maximum is reached', async () => {
      users.row = { ...users.row, lastLogin: new Date() };
      await redis.set(userKey, 3, 'PX', config.loginAttempts.ttl);

      await expect(signIn(password)).rejects.toBeInstanceOf(TooManyRequestsException);
    });

    it('lets the right password in after failed sign-ins and counts from zero again', async () => {
      await expect(signIn('a-wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(signIn('a-wrong-password')).rejects.toBeInstanceOf(UnauthorizedException);
      expect(redis.value(userKey)).toBe(2);

      const user = await signIn(password);
      expect(user.id).toBe('user-1');
      expect(redis.value(userKey)).toBe(0);
    });

    it('counts a sign-in to an account without a password, as before', async () => {
      users.row = { ...users.row, encryptedPassword: null, lastLogin: new Date() };
      await redis.set(userKey, 1, 'PX', config.loginAttempts.ttl);

      await expect(signIn(password)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(redis.value(userKey)).toBe(2);
    });

    it('does not count a sign-in with a published password, as before', async () => {
      const encryptedPassword = Buffer.from(await bcrypt.hash(publishedPassword, 4), 'utf-8');
      users.row = { ...users.row, encryptedPassword, lastLogin: new Date() };
      await redis.set(userKey, 1, 'PX', config.loginAttempts.ttl);

      await expect(signIn(publishedPassword)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(users.row.encryptedPassword).toBeNull();
      expect(redis.value(userKey)).toBe(1);
    });

    it('takes the attempt of a published password back no lower than 0', async () => {
      const encryptedPassword = Buffer.from(await bcrypt.hash(publishedPassword, 4), 'utf-8');
      users.row = { ...users.row, encryptedPassword, lastLogin: new Date() };
      // A sign-in with the right password resets the count meanwhile
      duringPasswordCheck(() => redis.set(userKey, 0, 'PX', config.loginAttempts.ttl));

      await expect(signIn(publishedPassword)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(redis.value(userKey)).toBe(0);
    });

    it('does not create the count again to take back the attempt of a published password once it expired', async () => {
      const encryptedPassword = Buffer.from(await bcrypt.hash(publishedPassword, 4), 'utf-8');
      users.row = { ...users.row, encryptedPassword, lastLogin: new Date() };
      duringPasswordCheck(() => redis.advance(config.loginAttempts.ttl));

      await expect(signIn(publishedPassword)).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(redis.value(userKey)).toBeUndefined();
    });
  });
});
