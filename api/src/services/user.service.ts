import { BadRequestException, ConflictException, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as moment from 'moment';
import { Repository } from 'typeorm';
import { GrantType } from '../domain/http';
import { normalizeEmail } from '../domain/validators';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { TooManyRequestsException } from '../errors';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(ProjectUser) private projectUsersRepo: Repository<ProjectUser>,
  ) {}

  async userExists(email: string): Promise<boolean> {
    const normalizedEmail = normalizeEmail(email);
    const user = await this.userRepo.findOne({ email: normalizedEmail });
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
    const exists = await this.userRepo.findOne({ email: normalizedEmail });

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

    user.passwordResetExpires = moment()
      .add(4, 'hours')
      .toDate();

    await this.userRepo.update(user.id, user);

    return { user, token };
  }

  async updateUserData(userId: string, updates: { name?: string; email?: string }): Promise<User> {
    if (updates.email) {
      updates.email = normalizeEmail(updates.email);
    }
    await this.userRepo.update(userId, updates);
    return await this.userRepo.findOneOrFail(userId);
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
    const user = await this.userRepo.findOneOrFail({ id: userId });

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
    const normalizedEmail = normalizeEmail(email);
    const user = await this.userRepo.findOneOrFail({ email: normalizedEmail });

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
    const user = await this.userRepo.findOne({ email: normalizedEmail });
    if (!user) {
      throw new UnauthorizedException('invalid credentials');
    }

    switch (grantType) {
      case GrantType.Password:
        if (!user.encryptedPassword) {
          await this.userRepo.increment({ id: user.id }, 'loginAttempts', 1);
          throw new UnprocessableEntityException('No password for this user, was this account created via a provider?');
        }

        const valid = await new Promise((resolve, reject) => {
          bcrypt.compare(password, user.encryptedPassword.toString('utf8'), (err, same) => {
            if (err) {
              reject(err);
            } else {
              resolve(same);
            }
          });
        });
        // When credentials are invalid, increment login attempts and respond with error
        if (!valid) {
          await this.userRepo.increment({ id: user.id }, 'loginAttempts', 1);
          throw new UnauthorizedException('invalid credentials');
        }
        break;

      default:
        throw new BadRequestException('Tried to authenticate with unsupported grant type');
    }

    user.lastLogin = new Date();

    // All good, reset login attempts
    user.loginAttempts = 0;
    await this.userRepo.save(user);

    return user;
  }
}
