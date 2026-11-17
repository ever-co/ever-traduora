import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FindOperator, Repository } from 'typeorm';
import { GrantType } from '../domain/http';
import { ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { TooManyRequestsException } from '../errors';
import { UserLoginAttemptsStorage } from '../redis/user-login-attempts.storage';
import { UserService } from './user.service';

// The operators UserService puts in its where clauses
const matches = (value: any, condition: any): boolean => {
  if (condition instanceof FindOperator) {
    switch (condition.type) {
      case 'isNull':
        return value === null || value === undefined;
      case 'lessThan':
        return value !== null && value !== undefined && value < condition.value;
      case 'or':
        return (condition.value as unknown as FindOperator<any>[]).some(child => matches(value, child));
      default:
        throw new Error(`operator ${condition.type} is not supported by this mock`);
    }
  }
  return value === condition;
};

// One stored row: the service gets copies, as from a database
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
}

describe('UserService', () => {
  describe('authenticate without Redis', () => {
    const email = 'login-attempts@example.test';
    const password = 'my-right-password-t2538';
    let users: InMemoryUserRepository;
    let service: UserService;

    const signIn = (attempt: string) => service.authenticate({ grantType: GrantType.Password, email, password: attempt });

    beforeEach(async () => {
      users = new InMemoryUserRepository({
        id: 'user-1',
        name: 'Login Attempts',
        email,
        encryptedPassword: Buffer.from(await bcrypt.hash(password, 4), 'utf-8'),
        loginAttempts: 5,
        lastLogin: new Date(Date.now() - 20 * 60 * 1000),
      } as User);
      // Without REDIS_HOST and REDIS_PORT there is no Redis client: the count is the one stored on the user
      const loginAttemptsStorage = { getRedisClient: () => null } as unknown as UserLoginAttemptsStorage;
      service = new UserService(users as unknown as Repository<User>, {} as unknown as Repository<ProjectUser>, loginAttemptsStorage);
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
      users.row = { ...users.row, loginAttempts: 3, lastLogin: new Date() };

      await expect(signIn(password)).rejects.toBeInstanceOf(TooManyRequestsException);
      expect(users.row.loginAttempts).toBe(4);
    });
  });
});
