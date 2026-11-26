import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as moment from 'moment';
import { EntityManager, IsNull, LessThan, MoreThan, Or, Repository } from 'typeorm';
import { GrantType } from '../domain/http';
import { normalizeEmail } from '../domain/validators';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { PublishedPasswordException, TooManyRequestsException } from '../errors';
import { UserLoginAttemptsStorage } from '../redis/user-login-attempts.storage';
import { config } from '../config';
import { isPublishedPassword } from '../utils/published-passwords';
import { lockProjectsOf, readCommittedTransaction } from '../utils/database-locks';
import { lockAccount } from './ever-id-session.service';
import { EMAIL_VERIFICATION_VALID_DAYS, generateEmailVerificationToken, hashEmailVerificationToken } from '../utils/email-verification-token';
import { joinDefaultOrganization, passOwnershipBeforeAccountDeletion } from './organization/organization-membership';

const noEmailVerificationToken = { emailVerificationTokenHash: null, emailVerificationExpires: null };

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
    // A single-tenant install has one organization that everyone is in. In SaaS mode the sign-up decides: the
    // inviting organization, or the person's own (AuthController, OrganizationService.setUpNewAccount)
    if (!config.saasEnabled) {
      await joinDefaultOrganization(this.userRepo.manager, newUser.id);
    }
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

    // Write only the reset token, and only for the email it is sent to: writing the loaded user would put back
    // anything changed meanwhile (e.g. a published password removed by a concurrent sign-in), and changing the email
    // in the meantime discards the token
    const { affected } = await this.userRepo.update(
      { id: user.id, email: user.email },
      { encryptedPasswordResetToken: user.encryptedPasswordResetToken, passwordResetExpires: user.passwordResetExpires },
    );
    if (!affected) {
      throw new NotFoundException('user not found');
    }

    return { user, token };
  }

  async updateUserData(userId: string, updates: { name?: string; email?: string }): Promise<{ user: User; emailChanged: boolean }> {
    const current = await this.userRepo.findOneByOrFail({ id: userId });
    const changes: Partial<User> = { ...updates };
    if (updates.email) {
      changes.email = normalizeEmail(updates.email);
    }

    // Nothing proves that the owner reads the new address, and links sent to the old one must not count for it
    const emailChanged = changes.email !== undefined && changes.email !== current.email;
    if (emailChanged) {
      Object.assign(changes, {
        emailVerified: false,
        ...noEmailVerificationToken,
        encryptedPasswordResetToken: Buffer.from('', 'utf-8'),
        passwordResetExpires: null,
      });
    }

    // Only if the email is still the one compared above: a concurrent change could otherwise keep a verification
    // that belongs to another address
    const { affected } = await this.userRepo.update({ id: userId, email: current.email }, changes);
    if (!affected) {
      throw new ConflictException('the account changed in the meantime, please try again');
    }
    return { user: await this.userRepo.findOneByOrFail({ id: userId }), emailChanged };
  }

  /**
   * Stores a new email verification token for the user's current email and returns it, or returns null if the email
   * changed since the user was loaded.
   */
  async startEmailVerification(user: User): Promise<string | null> {
    const token = generateEmailVerificationToken();
    const { affected } = await this.userRepo.update(
      { id: user.id, email: user.email },
      {
        emailVerificationTokenHash: hashEmailVerificationToken(token),
        emailVerificationExpires: moment().add(EMAIL_VERIFICATION_VALID_DAYS, 'days').toDate(),
      },
    );
    return affected ? token : null;
  }

  /**
   * Verifies the email of the signed-in user. The token proves that they read the mailbox, and the session that they
   * own the account: whoever reads the mailbox of an account someone else registered must not verify it for them.
   */
  async verifyEmail(token: string, userId: string): Promise<User> {
    const tokenHash = hashEmailVerificationToken(token);
    const user = await this.userRepo.findOneBy({ id: userId, emailVerificationTokenHash: tokenHash });
    if (!user || !user.emailVerificationExpires || moment(user.emailVerificationExpires).isBefore(Date.now())) {
      throw new NotFoundException('verification link not found');
    }

    const { affected } = await this.userRepo.update(
      { id: user.id, email: user.email, emailVerificationTokenHash: tokenHash },
      { emailVerified: true, ...noEmailVerificationToken },
    );
    if (!affected) {
      throw new NotFoundException('verification link not found');
    }
    return { ...user, emailVerified: true, ...noEmailVerificationToken };
  }

  /**
   * Verifies the email when a sign-in provider vouches that the caller reads it, if the account still has that email
   * and had not proved it yet. Then whoever set the account's password may not be its owner, since anyone can sign up
   * with any email: the password is removed and existing sessions end. The owner can set a new password with a reset.
   * Returns whether the account was verified now.
   */
  async verifyEmailWithProvider(userId: string, email: string): Promise<boolean> {
    // One transaction: a claim that removed the password but kept the sessions could not be completed by a retry
    return this.userRepo.manager.transaction(async entityManager => {
      const { affected } = await entityManager.update(
        User,
        { id: userId, email: normalizeEmail(email), emailVerified: false },
        { emailVerified: true, ...noEmailVerificationToken, encryptedPassword: null },
      );
      if (affected) {
        await this.endSessions(userId, entityManager);
      }
      return !!affected;
    });
  }

  async findById(userId: string): Promise<User | null> {
    return this.userRepo.findOneBy({ id: userId });
  }

  /**
   * Ends all sessions of the user: access tokens issued before no longer work.
   */
  private async endSessions(userId: string, entityManager: EntityManager): Promise<void> {
    await entityManager.increment(User, { id: userId }, 'sessionVersion', 1);
  }

  /**
   * Deletes the account, unless it is the last admin of a project that other users use. The account's row and then every
   * project it belongs to are locked before its admin roles are read and the projects' admins counted, as Ever
   * Platform's deletion path locks them ({@link lockProjectsOf}): a deletion or role change at the same time waits, then
   * counts what this one left.
   */
  async deleteAccount(user: User) {
    await readCommittedTransaction(this.userRepo.manager, async manager => {
      await lockAccount(manager, user.id);
      await lockProjectsOf(manager, [user.id]);
      const memberships = manager.getRepository(ProjectUser);
      const ownedProjects = await memberships.find({
        where: { user: { id: user.id }, role: ProjectRole.Admin },
        relations: ['project'],
      });
      const projectIds = ownedProjects.filter(owned => owned.project).map(owned => owned.project.id);

      // Ensure user is not last project admin for any of their projects with other users
      for (const projectId of projectIds) {
        const projectUsers = await memberships.find({
          where: { project: { id: projectId } },
          relations: ['user'],
        });

        const otherUsers = projectUsers.filter(u => u.user.id !== user.id);

        if (otherUsers.length > 0 && !otherUsers.some(u => u.role === ProjectRole.Admin)) {
          throw new UnprocessableEntityException('cant delete account if last project admin and other users use project');
        }
      }

      // An organization the user owns passes to another member, or the deletion waits for a transfer (SaaS mode)
      await passOwnershipBeforeAccountDeletion(manager, user.id);

      await manager.getRepository(User).remove(user);
    });
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string): Promise<User> {
    assertNotPublishedPassword(newPassword);
    const user = await this.userRepo.findOneByOrFail({ id: userId });
    if (!user.encryptedPassword) {
      throw new UnauthorizedException('invalid credentials');
    }

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

    const checkedPassword = user.encryptedPassword;
    user.encryptedPassword = Buffer.from(await bcrypt.hash(newPassword, 10), 'utf-8');

    // Write only the password, and only over the one that was checked: a password reset or provider sign-in that
    // replaced or removed it in the meantime must not be undone
    const { affected } = await this.userRepo.update(
      { id: user.id, encryptedPassword: checkedPassword },
      { encryptedPassword: user.encryptedPassword },
    );
    if (!affected) {
      throw new UnauthorizedException('invalid credentials');
    }
    return user;
  }

  async resetPassword(email: string, token: string, newPassword: string): Promise<User> {
    assertNotPublishedPassword(newPassword);
    const normalizedEmail = normalizeEmail(email);
    const user = await this.userRepo.findOneByOrFail({ email: normalizedEmail });
    if (!user.encryptedPasswordResetToken?.length) {
      throw new UnauthorizedException('token is not valid');
    }

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

    const changes: Partial<User> = {
      encryptedPassword: Buffer.from(await bcrypt.hash(newPassword, 10), 'utf-8'),
      encryptedPasswordResetToken: Buffer.from('', 'utf-8'),
      // The token was emailed to this address, so its owner reads it and now holds the account
      emailVerified: true,
      ...noEmailVerificationToken,
    };

    // Only while the account still has the email the token was sent to
    // Together with the new password, sessions opened with the previous one end, e.g. those of someone who registered
    // this email first: one transaction, since the used token cannot be retried
    await this.userRepo.manager.transaction(async entityManager => {
      // Only with the token that was checked: a reset that already used it, or a newer forgot-password, replaced it
      const { affected } = await entityManager.update(
        User,
        { id: user.id, email: normalizedEmail, encryptedPasswordResetToken: user.encryptedPasswordResetToken },
        changes,
      );
      if (!affected) {
        throw new UnauthorizedException('token is not valid');
      }
      await this.endSessions(user.id, entityManager);
    });
    return { ...user, ...changes, sessionVersion: user.sessionVersion + 1 };
  }

  async authenticate({ grantType, email, password }: { grantType: GrantType; email: string; password?: string }): Promise<User> {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.userRepo.findOneBy({ email: normalizedEmail });

    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }

    // Only the password grant signs in here, so other grants do not count as sign-in attempts
    if (grantType !== GrantType.Password) {
      throw new BadRequestException('Tried to authenticate with unsupported grant type');
    }

    const userKey = `user-${user.id}`;
    const timeThreshold = moment().subtract(15, 'minutes').toDate();

    // Reset login attempts if the last login is older than 15 minutes. With Redis the count expires instead.
    if (user.lastLogin < timeThreshold && !this.loginAttemptsStorage.getRedisClient()) {
      await this.clearExpiredLoginAttempts(user, timeThreshold);
    }

    // Count this attempt before its password is checked: parallel attempts then cannot all pass on the same count
    if (!(await this.countLoginAttempt(user, userKey))) {
      throw new TooManyRequestsException('You have made too many requests. Please try again later.');
    }

    await this.handlePasswordAuthentication(user, password, userKey);

    // All good, reset login attempts
    await this.resetLoginAttempts(userKey, user);

    return user;
  }

  // Without Redis the count is the one stored on the user: once the window has passed it starts again from 0 there too,
  // else the next failed attempt adds to the old count. Only while lastLogin is still that old, so that a failed attempt
  // made meanwhile keeps counting.
  private async clearExpiredLoginAttempts(user: User, timeThreshold: Date): Promise<void> {
    await this.userRepo.update({ id: user.id, lastLogin: Or(LessThan(timeThreshold), IsNull()) }, { loginAttempts: 0 });
  }

  // The attempt was counted before this, so a wrong password or an account without one only throws
  private async handlePasswordAuthentication(user: User, password: string, userKey: string): Promise<void> {
    if (!user.encryptedPassword) {
      throw new UnprocessableEntityException('No password for this user. Was this account created via a provider?');
    }

    const isValidPassword = await bcrypt.compare(password, user.encryptedPassword.toString('utf8'));

    if (!isValidPassword) {
      throw new UnauthorizedException('invalid credentials');
    }

    // Anyone can sign in with a published password, such as the former default admin one, so it is removed from the
    // account. The owner sets a new one with a password reset, or the seed sets TR_ADMIN_PASSWORD on the admin account.
    if (isPublishedPassword(password)) {
      // Only the hash just checked: a password reset that finished during bcrypt.compare must not be undone
      await this.userRepo.update({ id: user.id, encryptedPassword: user.encryptedPassword }, { encryptedPassword: null });
      // The password was right, so this is not a failed attempt: the count goes back to what it was
      await this.uncountLoginAttempt(user, userKey);
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
  // e.g. a published password removed by a concurrent sign-in.
  // Counts an attempt and returns whether it may go on, that is whether fewer than the maximum were counted before it.
  // Each count is one atomic write that returns its own result, so parallel attempts cannot all see the same count.
  // lastLogin moves first, for refused attempts too: once it has moved, a sign-in that read the user before can no
  // longer clear the counts made since as older than the window.
  private async countLoginAttempt(user: User, userKey: string): Promise<boolean> {
    user.lastLogin = new Date();
    await this.userRepo.update({ id: user.id }, { lastLogin: user.lastLogin });

    if (this.loginAttemptsStorage.getRedisClient()) {
      const loginAttempts = await this.loginAttemptsStorage.incrementUserAttempts(userKey, this.loginAttemptsTTL);
      return loginAttempts <= this.maxLoginAttempts;
    }
    // Only while below the maximum, so the stored count stops there
    const { affected } = await this.userRepo.increment({ id: user.id, loginAttempts: LessThan(this.maxLoginAttempts) }, 'loginAttempts', 1);
    return affected > 0;
  }

  // Takes back the attempt that countLoginAttempt counted
  private async uncountLoginAttempt(user: User, userKey: string): Promise<void> {
    if (this.loginAttemptsStorage.getRedisClient()) {
      await this.loginAttemptsStorage.decrementUserAttempts(userKey);
      return;
    }
    await this.userRepo.decrement({ id: user.id, loginAttempts: MoreThan(0) }, 'loginAttempts', 1);
  }

  private async resetLoginAttempts(userKey: string, user: User): Promise<void> {
    if (this.loginAttemptsStorage.getRedisClient()) {
      await this.loginAttemptsStorage.setUserAttempts(userKey, 0, this.loginAttemptsTTL); // Reset attempts in Redis
    }
    user.loginAttempts = 0;
    await this.userRepo.update({ id: user.id }, { loginAttempts: 0 });
  }
}
