import { BadRequestException, ConflictException, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as moment from 'moment';
import { IsNull, Repository } from 'typeorm';
import { GrantType } from '../domain/http';
import { normalizeEmail } from '../domain/validators';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { PublishedPasswordException, TooManyRequestsException } from '../errors';
import { UserLoginAttemptsStorage } from '../redis/user-login-attempts.storage';
import { config } from '../config';
import { isPublishedPassword } from '../utils/published-passwords';

const assertNotPublishedPassword = (password: string) => {
  if (isPublishedPassword(password)) {
    throw new PublishedPasswordException();
  }
};

@Injectable()
export class UserService {
  private readonly loginAttemptsTTL: number;
  private readonly maxLoginAttempts: number;

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(ProjectUser) private projectUsersRepo: Repository<ProjectUser>,
    private readonly loginAttemptsStorage: UserLoginAttemptsStorage,
  ) {
    this.loginAttemptsTTL = config.loginAttempts.ttl;
    this.maxLoginAttempts = config.loginAttempts.maxAttempts;
  }

  async userExists(email: string): Promise<boolean> {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.userRepo.findOneBy({ email: normalizedEmail });
    return user != null;
  }

  async create({
    grantType,
    email,
    name,
    password,
  }: {
    grantType: GrantType;
    email: string;
    name: string;
    password?: string;
  }): Promise<{ user: User; isNewUser: boolean }> {
    const normalizedEmail = normalizeEmail(email);
    const exists = await this.userRepo.findOneBy({ email: normalizedEmail });

    if (exists) {
      // Attempting to create an account via provider is idempotent
      // We offload prooving the user's identity to the provider
      if (grantType === GrantType.Provider) {
        return { user: exists, isNewUser: false };
      } else {
        throw new ConflictException('a user with this email already exists');
      }
    }

    const user = new User();
    user.name = name;
    user.email = normalizedEmail;

    if (grantType === GrantType.Password) {
      if (!password) {
        throw new BadRequestException('you need a password to create an account');
      }
      assertNotPublishedPassword(password);

      user.encryptedPassword = Buffer.from(await bcrypt.hash(password, 10), 'utf-8');
    }

    const newUser = await this.userRepo.save(user);
    return { user: newUser, isNewUser: true };
  }

  async forgotPassword(email: string): Promise<{ user: User; token: string }> {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.userRepo.findOneOrFail({
      where: { email: normalizedEmail },
    });

    const token = await new Promise<string>((resolve, reject) => {
      crypto.randomBytes(32, (err, buf) => {
        if (err) {
          reject(err);
        } else {
          resolve(buf.toString('hex'));
        }
      });
    });

    user.encryptedPasswordResetToken = Buffer.from(await bcrypt.hash(token, 10), 'utf-8');

    user.passwordResetExpires = moment().add(4, 'hours').toDate();

    // Write only the reset token: writing the loaded user would put back anything changed meanwhile, e.g. a published
    // password removed by a concurrent sign-in
    await this.userRepo.update(
      { id: user.id },
      { encryptedPasswordResetToken: user.encryptedPasswordResetToken, passwordResetExpires: user.passwordResetExpires },
    );

    return { user, token };
  }

  async updateUserData(userId: string, updates: { name?: string; email?: string }): Promise<User> {
    if (updates.email) {
      updates.email = normalizeEmail(updates.email);
    }
    await this.userRepo.update(userId, updates);
    return await this.userRepo.findOneByOrFail({ id: userId });
  }

  async deleteAccount(user: User) {
    const ownedProjects = await this.projectUsersRepo.find({
      where: { user: { id: user.id }, role: ProjectRole.Admin },
      relations: ['project'],
    });

    // Ensure user is not last project admin for any of their projects with other users
    if (ownedProjects && ownedProjects.length > 0) {
      for (const ownedProject of ownedProjects) {
        const projectUsers = await this.projectUsersRepo.find({
          where: { project: { id: ownedProject.project.id } },
          relations: ['user'],
        });

        const otherUsers = projectUsers.filter(u => u.user.id !== user.id);

        if (otherUsers && otherUsers.length > 0) {
          const otherAdmins = otherUsers.find(u => u.role === ProjectRole.Admin);

          if (!otherAdmins) {
            throw new UnprocessableEntityException('cant delete account if last project admin and other users use project');
          }
        }
      }
    }

    await this.userRepo.remove(user);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<User> {
    assertNotPublishedPassword(newPassword);
    const user = await this.userRepo.findOneByOrFail({ id: userId });

    const valid = await new Promise((resolve, reject) => {
      bcrypt.compare(oldPassword, user.encryptedPassword.toString('utf8'), (err, same) => {
        if (err) {
          reject(err);
        } else {
          resolve(same);
        }
      });
    });

    if (!valid) {
      throw new UnauthorizedException('invalid credentials');
    }

    user.encryptedPassword = Buffer.from(await bcrypt.hash(newPassword, 10), 'utf-8');

    return await this.userRepo.save(user);
  }

  async resetPassword(email: string, token: string, newPassword: string): Promise<User> {
    assertNotPublishedPassword(newPassword);
    const normalizedEmail = normalizeEmail(email);
    const user = await this.userRepo.findOneByOrFail({ email: normalizedEmail });

    const valid = await new Promise((resolve, reject) => {
      bcrypt.compare(token, user.encryptedPasswordResetToken.toString('utf8'), (err, same) => {
        if (err) {
          reject(err);
        } else {
          resolve(same);
        }
      });
    });

    // Token doesn't match
    if (!valid) {
      throw new UnauthorizedException('token is not valid');
    }

    // Token has expired
    if (moment(user.passwordResetExpires).isBefore(Date.now())) {
      throw new UnauthorizedException('token is expired');
    }

    user.encryptedPassword = Buffer.from(await bcrypt.hash(newPassword, 10), 'utf-8');
    user.encryptedPasswordResetToken = Buffer.from('', 'utf-8');

    return await this.userRepo.save(user);
  }

  async authenticate({ grantType, email, password }: { grantType: GrantType; email: string; password?: string }): Promise<User> {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.userRepo.findOneBy({ email: normalizedEmail });

    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }

    const userKey = `user-${user.id}`;
    const timeThreshold = moment().subtract(15, 'minutes').toDate();

    let loginAttempts = await this.getLoginAttempts(userKey, user);

    // Reset login attempts if the last login is older than 15 minutes
    if (user.lastLogin < timeThreshold) {
      loginAttempts = 0;
    }

    // Handle too many login attempts
    if (loginAttempts >= this.maxLoginAttempts) {
      await this.incrementLoginAttempts(user, loginAttempts, userKey);
      throw new TooManyRequestsException('You have made too many requests. Please try again later.');
    }

    // Handle password grant type authentication
    if (grantType === GrantType.Password) {
      await this.handlePasswordAuthentication(user, password, loginAttempts, userKey);
    } else {
      throw new BadRequestException('Tried to authenticate with unsupported grant type');
    }

    // All good, reset login attempts
    await this.resetLoginAttempts(userKey, user);

    return user;
  }

  private async getLoginAttempts(userKey: string, user: User): Promise<number> {
    if (this.loginAttemptsStorage.getRedisClient()) {
      // Fetch login attempts from Redis if available
      return await this.loginAttemptsStorage.getUserAttempts(userKey);
    }
    // Fall back to using the database
    return user.loginAttempts;
  }

  private async handlePasswordAuthentication(user: User, password: string, loginAttempts: number, userKey: string): Promise<void> {
    if (!user.encryptedPassword) {
      await this.incrementLoginAttempts(user, loginAttempts, userKey);
      throw new UnprocessableEntityException('No password for this user. Was this account created via a provider?');
    }

    const isValidPassword = await bcrypt.compare(password, user.encryptedPassword.toString('utf8'));

    if (!isValidPassword) {
      await this.incrementLoginAttempts(user, loginAttempts, userKey);
      throw new UnauthorizedException('invalid credentials');
    }

    // Anyone can sign in with a published password, such as the former default admin one, so it is removed from the
    // account. The owner sets a new one with a password reset, or the seed sets TR_ADMIN_PASSWORD on the admin account.
    if (isPublishedPassword(password)) {
      // Only the hash just checked: a password reset that finished during bcrypt.compare must not be undone
      await this.userRepo.update({ id: user.id, encryptedPassword: user.encryptedPassword }, { encryptedPassword: null });
      throw new UnprocessableEntityException('this account used a publicly known password, please reset it');
    }
  }

  /**
   * Sets a password on an account that has none, e.g. after a published password was removed from it.
   * Returns whether the password was set.
   */
  async setMissingPassword(email: string, password: string): Promise<boolean> {
    assertNotPublishedPassword(password);
    const encryptedPassword = Buffer.from(await bcrypt.hash(password, 10), 'utf-8');
    const { affected } = await this.userRepo.update({ email: normalizeEmail(email), encryptedPassword: IsNull() }, { encryptedPassword });
    return !!affected;
  }

  // Login attempts write only their own columns: saving the loaded user would put back anything changed meanwhile,
  // e.g. a published password removed by a concurrent sign-in
  private async incrementLoginAttempts(user: User, loginAttempts: number, userKey: string): Promise<void> {
    user.lastLogin = new Date();
    await this.userRepo.update({ id: user.id }, { lastLogin: user.lastLogin });

    if (this.loginAttemptsStorage.getRedisClient()) {
      await this.loginAttemptsStorage.setUserAttempts(userKey, loginAttempts + 1, this.loginAttemptsTTL);
    }
    await this.userRepo.increment({ id: user.id }, 'loginAttempts', 1);
  }

  private async resetLoginAttempts(userKey: string, user: User): Promise<void> {
    if (this.loginAttemptsStorage.getRedisClient()) {
      await this.loginAttemptsStorage.setUserAttempts(userKey, 0, this.loginAttemptsTTL); // Reset attempts in Redis
    }
    user.loginAttempts = 0;
    await this.userRepo.update({ id: user.id }, { loginAttempts: 0 });
  }
}
