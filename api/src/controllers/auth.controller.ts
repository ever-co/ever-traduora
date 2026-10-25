import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { IsNull, Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { config } from '../config';
import {
  AcceptInviteRequest,
  AcceptInviteResponse,
  AccessTokenDTO,
  AuthenticateRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  GrantType,
  JwtPayload,
  ResetPasswordRequest,
  SignupRequest,
  SignupResponse,
  ListAuthProvidersResponse,
  AuthProviderDTO,
  ServiceApiResponse,
  VerifyEmailRequest,
  VerifyEmailResponse,
} from '../domain/http';
import { normalizeEmail } from '../domain/validators';
import { Invite, InviteStatus } from '../entity/invite.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { AuthService } from '../services/auth.service';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';
import { DbType, isDbType } from '../utils/database-type-helper';
import { verifyEmailUrl } from '../utils/email-verification-token';
import { hashInviteToken } from '../utils/invite-token';

@Controller('api/v1/auth')
@ApiTags('Authentication')
export class AuthController {
  constructor(
    private mailService: MailService,
    private userService: UserService,
    private jwtService: JwtService,
    @InjectRepository(Invite) private inviteRepo: Repository<Invite>,
    private authorizationService: AuthorizationService,
    @InjectRepository(ProjectClient) private projectClientRepo: Repository<ProjectClient>,
    private authService: AuthService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'List available external auth providers' })
  @ApiResponse({ status: HttpStatus.OK, type: ListAuthProvidersResponse, description: 'Success' })
  @HttpCode(HttpStatus.OK)
  async getProviders(): Promise<ServiceApiResponse<AuthProviderDTO[]>> {
    return {
      data: Object.keys(config.providers).reduce((acc, provider) => {
        const { url, active, redirectUrl, clientId } = config.providers[provider];
        return active ? [...acc, { slug: provider, url, redirectUrl, clientId }] : acc;
      }, []),
    };
  }

  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create a new user account' })
  @ApiResponse({ status: HttpStatus.OK, type: SignupResponse, description: 'User account created' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'A user with this email already exists' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'The email has a pending invitation and the invite token is missing or invalid' })
  async signup(@Body() payload: SignupRequest) {
    const normalizedEmail = normalizeEmail(payload.email);
    const { inviteToken, ...signup } = payload;

    // check for invite
    const invites = await this.inviteRepo.find({
      where: { email: normalizedEmail, status: InviteStatus.Sent },
      relations: ['project'],
    });

    // Nothing proves that the caller owns this email. The token from an invitation link only proves that they received
    // that one invitation, by email or from the admin who sent it, so it accepts that invitation and no other.
    const tokenHash = inviteToken ? hashInviteToken(inviteToken) : undefined;
    const acceptedInvites = invites.filter(invite => invite.tokenHash && invite.tokenHash === tokenHash);
    if (invites.length > 0 && acceptedInvites.length === 0) {
      throw new UnauthorizedException('A valid invite token is required to sign up with this email.');
    }

    // Early exit if the user has no invitation and sign up is disabled.
    if (invites.length === 0 && !config.signupsEnabled) {
      throw new ForbiddenException('Signups are invitation based only.');
    }

    const { user, isNewUser } = await this.userService.create({ grantType: GrantType.Password, ...signup });

    await this.acceptInvites(acceptedInvites, user);

    const token = this.signUserToken(user);

    if (isNewUser) {
      await this.welcomeNewUser(user);
    }

    return {
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        accessToken: token,
      },
    };
  }

  private signUserToken(user: User): string {
    const tokenPayload: JwtPayload = { sub: user.id, type: 'user', sv: user.sessionVersion ?? 0 };
    return this.jwtService.sign(tokenPayload);
  }

  /**
   * Sends the welcome email, with a link to verify the email unless it is verified already. Not awaited: MailService
   * logs delivery failures.
   */
  private async welcomeNewUser(user: User, emailVerified = false) {
    const verificationToken = emailVerified ? null : await this.userService.startEmailVerification(user);
    void this.mailService.welcomeNewUser(user, verificationToken ? verifyEmailUrl(verificationToken) : undefined);
  }

  @Post('signup-provider')
  async signupWithProvider(@Body() { code }: { code: string }): Promise<{ data: { id: string; email: string; name: string; accessToken: string } }> {
    const { id_token } = await this.authService.getTokenFromGoogle(code);
    const decodedToken = this.jwtService.decode(id_token, { json: true }) as { email: string; name: string; email_verified?: boolean };

    const normalizedEmail = normalizeEmail(decodedToken.email);

    // check for invite
    const invites = await this.inviteRepo.find({
      where: { email: normalizedEmail, status: InviteStatus.Sent },
      relations: ['project'],
    });

    // The provider vouches for the email only when it reports it as verified
    const emailVerified = decodedToken.email_verified === true;
    if (invites.length > 0 && !emailVerified) {
      throw new UnauthorizedException('The email must be verified with the provider to accept an invitation.');
    }

    // Signing in to an existing account by its email needs the same proof, or anyone with a provider account showing
    // that address could take it over
    const accountExists = await this.userService.userExists(decodedToken.email);
    if (accountExists && !emailVerified) {
      throw new UnauthorizedException('The email must be verified with the provider to sign in to an existing account.');
    }

    // This endpoint can be used for signing in too in the case of providers.
    // Ensure that we forbid a new account if we have disabled signups.
    // But still allow logging in in case the account had already been created.
    if (!config.signupsEnabled && invites.length === 0 && !accountExists) {
      throw new ForbiddenException('Signups are invitation based only.');
    }

    const { user, isNewUser } = await this.userService.create({ grantType: GrantType.Provider, name: decodedToken.name, email: decodedToken.email });

    if (emailVerified) {
      await this.userService.verifyEmailWithProvider(user.id, normalizedEmail);
    }

    // Reload: claiming the account ended its earlier sessions, and it must still have the provider's email (verified,
    // if the provider vouched for it) before it gets the email's invites, e.g. if its email changed in the meantime
    // An unverified provider email only creates accounts: an existing one (e.g. a password signup that finished since
    // the check above) is not signed in to, nor the new one once its sessions were ended (e.g. its mailbox owner reset
    // its password in the meantime)
    const account = await this.userService.findById(user.id);
    const unverifiedButNotFresh = !emailVerified && (!isNewUser || account?.sessionVersion !== (user.sessionVersion ?? 0));
    if (!account || account.email !== normalizedEmail || (emailVerified && !account.emailVerified) || unverifiedButNotFresh) {
      throw new UnauthorizedException('The account changed during sign-in, please try again.');
    }

    await this.acceptInvites(invites, account);

    const token = this.signUserToken(account);

    if (isNewUser) {
      await this.welcomeNewUser(user, emailVerified);
    }

    return {
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        accessToken: token,
      },
    };
  }

  @Throttle({
    default: {
      limit: config.throttle.auth.limit,
      ttl: config.throttle.auth.ttl,
    },
  })
  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request an authentication token for an existing user or project client',
    description:
      'The grant type must be one of **password** or **client_credentials**. ' +
      'When using a grant type of *password*, you must provide the fields *username* (email) and *password*. ' +
      'When using the grant type *client_credentials* you must provide the fields *client_id* and *client_secret*. ' +
      'The grant type **provider** is reserved for internal purposes and should not be used.',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Successfully authenticated', type: AccessTokenDTO })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No resource with such credentials found' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many attempts, please wait at least 15 minutes before retrying' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Bad credentials' })
  async token(@Body() payload: AuthenticateRequest) {
    switch (payload.grant_type) {
      case GrantType.Password: {
        if (!payload.username || !payload.password) {
          throw new BadRequestException('missing credentials');
        }
        const token = await this.authenticateUser(payload.username, payload.password);
        return {
          access_token: token,
          token_type: 'bearer',
          expires_in: `${config.authTokenExpires}s`,
        };
      }
      case GrantType.ClientCredentials: {
        if (!payload.client_id || !payload.client_secret) {
          throw new BadRequestException('missing credentials');
        }
        const token = await this.authenticateClient(payload.client_id, payload.client_secret);
        return {
          access_token: token,
          token_type: 'bearer',
          expires_in: `${config.authTokenExpires}s`,
        };
      }
      case GrantType.Provider: {
        if (!payload.code) {
          throw new BadRequestException('missing credentials');
        }
        const token = await this.authenticateProvider(payload.code);
        return { data: { accessToken: token } };
      }
      default:
        throw new BadRequestException('invalid grant type');
    }
  }

  private async authenticateUser(email, password) {
    const user = await this.userService.authenticate({ grantType: GrantType.Password, email, password });
    return this.signUserToken(user);
  }

  private async authenticateClient(clientId: string, password: string) {
    const client = await this.projectClientRepo.findOneOrFail({ where: { id: clientId } });
    const valid = await new Promise((resolve, reject) => {
      bcrypt.compare(password, client.encryptedSecret.toString('utf8'), (err, same) => {
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

    const tokenPayload: JwtPayload = { sub: client.id, type: 'client' };
    const token = this.jwtService.sign(tokenPayload);
    return token;
  }

  private async authenticateProvider(code: string) {
    const { id_token } = await this.authService.getTokenFromGoogle(code);

    const decodedToken = this.jwtService.decode(id_token, { json: true }) as { email: string; name: string };

    const user = await this.userService.authenticate({ grantType: GrantType.Provider, email: decodedToken.email });
    return this.signUserToken(user);
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request reset password email' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Email sent' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No user with such email found' })
  async forgotPassword(@Body() payload: ForgotPasswordRequest) {
    const { user, token } = await this.userService.forgotPassword(payload.email);
    this.mailService.passwordResetToken(user, token);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reset password from token' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Password changed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such resource found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async resetPassword(@Body() payload: ResetPasswordRequest) {
    const user = await this.userService.resetPassword(payload.email, payload.token, payload.newPassword);
    // The reset proved that the owner reads this email, which also verifies it
    await this.acceptPendingInvites(user);
    this.mailService.passwordChanged(user);
  }

  @Post('change-password')
  @UseGuards(AuthGuard())
  @ApiOAuth2([])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Change password using current one' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Password changed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such resource found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async changePassword(@Req() req, @Body() payload: ChangePasswordRequest) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });
    const user = await this.userService.changePassword(requestingUser.id, payload.oldPassword, payload.newPassword);
    this.mailService.passwordChanged(user);
  }

  @Post('verify-email')
  @UseGuards(AuthGuard())
  @ApiOAuth2([])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: `Verify the signed-in user's email with the token from its verification link` })
  @ApiResponse({ status: HttpStatus.OK, type: VerifyEmailResponse, description: 'Email verified' })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'The link is invalid, expired, already used, for another account, or for an email the account no longer has',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async verifyEmail(@Req() req, @Body() payload: VerifyEmailRequest) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });
    const user = await this.userService.verifyEmail(payload.token, requestingUser.id);
    await this.acceptPendingInvites(user);
    return { data: { email: user.email, emailVerified: true } };
  }

  /**
   * Accepts the pending invites of a user who just proved that they read their email, like a provider sign-in that
   * verified it: the invitations were sent to that mailbox.
   */
  private async acceptPendingInvites(user: User) {
    const invites = await this.inviteRepo.find({
      where: { email: user.email, status: InviteStatus.Sent },
      relations: ['project'],
    });
    await this.acceptInvites(invites, user);
  }

  @Throttle({
    default: {
      limit: config.throttle.auth.limit,
      ttl: config.throttle.auth.ttl,
    },
  })
  @Post('resend-verification-email')
  @UseGuards(AuthGuard())
  @ApiOAuth2([])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: `Email a new verification link for the current user's email` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Sent, or nothing to do because the email is verified already' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async resendVerificationEmail(@Req() req) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });
    if (requestingUser.emailVerified) {
      return;
    }
    // Replaces the previous link, which stops working
    const token = await this.userService.startEmailVerification(requestingUser);
    if (token) {
      void this.mailService.verifyEmail(requestingUser, verifyEmailUrl(token));
    }
  }

  @Post('accept-invite')
  @UseGuards(AuthGuard())
  @ApiOAuth2([])
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Accept a pending project invite with the token from its invitation link' })
  @ApiResponse({ status: HttpStatus.OK, type: AcceptInviteResponse, description: 'Invite accepted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No pending invite for this token and the signed-in email' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async acceptInvite(@Req() req, @Body() payload: AcceptInviteRequest) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });

    const invite = await this.inviteRepo.findOne({
      where: { tokenHash: hashInviteToken(payload.inviteToken), status: InviteStatus.Sent },
      relations: ['project'],
    });

    // The token proves that the caller received this invitation, and the link only works for the email it was sent to
    if (invite?.email !== normalizeEmail(requestingUser.email)) {
      throw new NotFoundException('invite not found');
    }

    const accepted = await this.acceptInvites([invite], requestingUser);
    if (accepted.length === 0) {
      throw new NotFoundException('invite not found');
    }

    return { data: { projectId: invite.project.id, role: invite.role } };
  }

  /**
   * Turns pending invites into project memberships. An invite is accepted only if it is still exactly as the caller
   * checked it, since an admin may have sent a new link, changed the role or deleted it in the meantime.
   */
  private acceptInvites(invites: Invite[], user: User): Promise<Invite[]> {
    if (invites.length === 0) {
      return Promise.resolve([]);
    }
    return this.inviteRepo.manager.transaction(async entityManager => {
      // Invites belong to the email they were sent to, so only while the account still has it. The row lock holds an
      // email change until this commits (SQLite runs one write transaction at a time and has no row locks).
      const current = await entityManager.findOne(User, {
        where: { id: user.id },
        select: ['id', 'email'],
        ...(isDbType(DbType.BETTER_SQLITE3) ? {} : { lock: { mode: 'pessimistic_write' as const } }),
      });
      const accepted: Invite[] = [];
      for (const invite of invites) {
        if (current?.email !== invite.email) {
          continue;
        }
        const { affected } = await entityManager.update(
          Invite,
          { id: invite.id, status: InviteStatus.Sent, role: invite.role, tokenHash: invite.tokenHash ?? IsNull() },
          { status: InviteStatus.Accepted, tokenHash: null },
        );
        if (!affected) {
          continue;
        }
        const membership = await entityManager.findOne(ProjectUser, {
          where: { project: { id: invite.project.id }, user: { id: user.id } },
        });
        if (!membership) {
          await entityManager.save(entityManager.create(ProjectUser, { project: { id: invite.project.id }, user, role: invite.role }));
        }
        accepted.push(invite);
      }
      return accepted;
    });
  }
}
