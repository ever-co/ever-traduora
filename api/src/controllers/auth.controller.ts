import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
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
  BackchannelLogoutRequest,
  ConnectIdentityConfirmRequest,
  ConnectIdentityRequest,
  ConnectIdentityResponse,
  IdentityResponse,
  ListIdentitiesResponse,
  NewUserDTO,
  ProviderSignInRequest,
  ProviderSignupConfirmRequest,
} from '../domain/http';
import { normalizeEmail } from '../domain/validators';
import { Invite, InviteStatus } from '../entity/invite.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { IdentityLinkMethod } from '../entity/user-identity.entity';
import { AuthProviderException } from '../errors';
import { OidcSignInThrottlerGuard } from '../guards/oidc-sign-in-throttler.guard';
import { AuthService } from '../services/auth.service';
import { CONNECT_PENDING_TTL_SECONDS, EverIdSessionService, SIGNUP_PENDING_TTL_SECONDS } from '../services/ever-id-session.service';
import { OidcError, OidcIdentity, OidcProviderService } from '../services/oidc-provider.service';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';
import { DbType, isDbType } from '../utils/database-type-helper';
import { verifyEmailUrl } from '../utils/email-verification-token';
import { hashInviteToken } from '../utils/invite-token';

/** The webapp sends Ever ID sign-ins with this provider slug. */
const EVERID = 'everid';

/** A connect from settings needs a sign-in at the provider at most this long ago, seconds (plus clock skew). */
const CONNECT_MAX_AUTH_AGE_SECONDS = 300;
const CONNECT_AUTH_AGE_SKEW_SECONDS = 60;

@Controller('api/v1/auth')
@ApiTags('Authentication')
export class AuthController {
  private readonly logger = new Logger('AuthController');

  constructor(
    private mailService: MailService,
    private userService: UserService,
    private jwtService: JwtService,
    @InjectRepository(Invite) private inviteRepo: Repository<Invite>,
    private authorizationService: AuthorizationService,
    @InjectRepository(ProjectClient) private projectClientRepo: Repository<ProjectClient>,
    private authService: AuthService,
    private oidcProviders: OidcProviderService,
    private everIdSessions: EverIdSessionService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'List available external auth providers' })
  @ApiResponse({ status: HttpStatus.OK, type: ListAuthProvidersResponse, description: 'Success' })
  @HttpCode(HttpStatus.OK)
  async getProviders(): Promise<ServiceApiResponse<AuthProviderDTO[]>> {
    return {
      data: Object.keys(config.providers).reduce((acc, provider) => {
        // An OpenID Connect provider (e.g. Ever ID) is listed once it is on and its discovery succeeded
        if (this.oidcProviders.handles(provider)) {
          const entry = this.oidcProviders.providerEntry(provider);
          return entry ? [...acc, entry] : acc;
        }
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
  @UseGuards(OidcSignInThrottlerGuard)
  async signupWithProvider(
    @Body() payload: ProviderSignInRequest,
  ): Promise<{ data: { id: string; email: string; name: string; accessToken: string } }> {
    // Any provider but Google (the default) is an OpenID Connect provider such as Ever ID: see signInWithOidc
    if (payload.provider && payload.provider !== 'google') {
      return this.signInWithOidc(payload);
    }
    const { code } = payload;
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
        if (payload.provider && payload.provider !== 'google') {
          const { data } = await this.signInWithOidc(payload);
          return { data: { accessToken: data.accessToken } };
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

  // Sign-in with an OpenID Connect provider (e.g. Ever ID). Accounts are found by the provider's issuer and subject
  // only: an equal email never signs in to an account nor attaches the identity to it. An identity is attached from
  // the account's settings (connect), or when an account is created after the sign-up confirmation screen.

  /**
   * Signs in with an authorization code of an OpenID Connect provider: the identity's account when it is attached to
   * one; otherwise 409 `account_exists` when an account has its email, or 409 `signup_confirmation_required` with a
   * sealed record to create the account with, after the person confirmed. Nothing is created before that.
   */
  private async signInWithOidc(payload: {
    code: string;
    provider?: string;
    nonce?: string;
    code_verifier?: string;
  }): Promise<{ data: { id: string; email: string; name: string; accessToken: string } }> {
    const slug = payload.provider;
    const identity = await this.verifyOidcCode(slug, payload);

    const linked = await this.everIdSessions.findIdentity(identity.issuer, identity.subject);
    if (linked) {
      const user = await this.userService.findById(linked.user.id);
      if (!user) {
        throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'sign_in_failed', 'The account of this identity no longer exists');
      }
      await this.everIdSessions.touchLastLogin(linked.id);
      // Unlike the Google sign-in, no pending invite is accepted here: the account accepts them itself
      const accessToken = await this.signOidcUserToken(user, identity.sid);
      return { data: { id: user.id, email: user.email, name: user.name, accessToken } };
    }

    // Only the configured issuer makes new links; the other accepted issuers sign in to existing ones
    if (identity.issuer !== this.oidcProviders.primaryIssuer(slug)) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'issuer_rejected', 'This issuer only signs in to accounts it is connected to');
    }

    // A boolean check only: the existing account is never signed in to, and nothing is linked to it
    if (await this.userService.userExists(identity.email)) {
      throw new AuthProviderException(
        HttpStatus.CONFLICT,
        'account_exists',
        'An account with this email already exists. Sign in the usual way, then connect Ever ID in your account settings.',
      );
    }

    const invites = await this.pendingInvites(identity.email);
    if (!config.signupsEnabled && invites.length === 0) {
      throw new AuthProviderException(HttpStatus.FORBIDDEN, 'signup_disabled', 'Signups are invitation based only.');
    }

    const pending = this.everIdSessions.seal({ purpose: 'signup', ...this.everIdSessions.pendingFrom(slug, identity) }, SIGNUP_PENDING_TTL_SECONDS);
    throw new AuthProviderException(HttpStatus.CONFLICT, 'signup_confirmation_required', 'Confirm to create your account', {
      pending,
      name: identity.name,
      email: normalizeEmail(identity.email),
      invites: invites.map(invite => ({ id: invite.id, projectName: invite.project?.name })),
    });
  }

  @Throttle({
    default: {
      limit: config.throttle.auth.limit,
      ttl: config.throttle.auth.ttl,
    },
  })
  @Post('everid/signup-confirm')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Create the account of an Ever ID sign-in, after the person confirmed it' })
  @ApiResponse({ status: HttpStatus.OK, type: NewUserDTO, description: 'Account created and signed in' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Ever ID sign-in is off, or the record is invalid or expired' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'An account with this email, or for this identity, exists already' })
  async confirmOidcSignup(@Body() payload: ProviderSignupConfirmRequest) {
    const pending = this.everIdSessions.unseal(payload.pending, 'signup');
    if (!pending) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'pending_invalid', 'The sign-up expired, please sign in again');
    }
    this.assertOidcActive(pending.provider);

    if (await this.everIdSessions.findIdentity(pending.issuer, pending.subject)) {
      throw new AuthProviderException(HttpStatus.CONFLICT, 'subject_linked', 'This identity is connected to an account already');
    }
    if (await this.userService.userExists(pending.email)) {
      throw new AuthProviderException(
        HttpStatus.CONFLICT,
        'account_exists',
        'An account with this email already exists. Sign in the usual way, then connect Ever ID in your account settings.',
      );
    }
    const invites = await this.pendingInvites(pending.email);
    if (!config.signupsEnabled && invites.length === 0) {
      throw new AuthProviderException(HttpStatus.FORBIDDEN, 'signup_disabled', 'Signups are invitation based only.');
    }

    const { user, isNewUser } = await this.userService.create({ grantType: GrantType.Provider, name: pending.name, email: pending.email });
    if (!isNewUser) {
      // Created by someone else since the check above: never signed in to
      throw new AuthProviderException(
        HttpStatus.CONFLICT,
        'account_exists',
        'An account with this email already exists. Sign in the usual way, then connect Ever ID in your account settings.',
      );
    }
    const identity = await this.everIdSessions.link(user.id, pending, IdentityLinkMethod.Jit);
    if (!identity) {
      // Attached to another account since the check above: the new account is not kept
      await this.userService.deleteAccount(user);
      throw new AuthProviderException(HttpStatus.CONFLICT, 'subject_linked', 'This identity is connected to an account already');
    }

    // The provider verified the email
    await this.userService.verifyEmailWithProvider(user.id, pending.email);
    const account = await this.userService.findById(user.id);

    // Only the invitations the person ticked on the confirmation screen
    const accept = new Set(payload.acceptInvites ?? []);
    await this.acceptInvites(
      invites.filter(invite => accept.has(invite.id)),
      account,
    );

    await this.welcomeNewUser(account, true);
    const accessToken = await this.signOidcUserToken(account, pending.sid);
    return { data: { id: account.id, email: account.email, name: account.name, accessToken } };
  }

  @Throttle({
    default: {
      limit: config.throttle.auth.limit,
      ttl: config.throttle.auth.ttl,
    },
  })
  @Post('identities/connect')
  @UseGuards(AuthGuard())
  @ApiOAuth2([])
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Start connecting an Ever ID to the signed-in account',
    description: 'Takes the authorization code of a fresh sign-in at the provider and answers both emails to confirm with',
  })
  @ApiResponse({ status: HttpStatus.OK, type: ConnectIdentityResponse, description: 'Waiting for the confirmation' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Ever ID sign-in is off, the sign-in failed or is not recent (reauth_required)' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The identity is connected already' })
  async connectIdentity(@Req() req, @Body() payload: ConnectIdentityRequest) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });
    const slug = payload.provider || EVERID;
    const identity = await this.verifyOidcCode(slug, payload);

    // A connect needs a fresh sign-in at the provider (the webapp asks for prompt=login and max_age=300)
    const now = Math.floor(Date.now() / 1000);
    if (identity.authTime === undefined || now - identity.authTime > CONNECT_MAX_AUTH_AGE_SECONDS + CONNECT_AUTH_AGE_SKEW_SECONDS) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'reauth_required', 'Please sign in to Ever ID again to connect it');
    }
    if (identity.issuer !== this.oidcProviders.primaryIssuer(slug)) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'issuer_rejected', 'This issuer only signs in to accounts it is connected to');
    }
    await this.assertConnectable(requestingUser.id, slug, identity.issuer, identity.subject);

    const pending = this.everIdSessions.seal(
      { purpose: 'connect', userId: requestingUser.id, ...this.everIdSessions.pendingFrom(slug, identity) },
      CONNECT_PENDING_TTL_SECONDS,
    );
    return { data: { pending, emails: { account: requestingUser.email, everId: normalizeEmail(identity.email) } } };
  }

  @Throttle({
    default: {
      limit: config.throttle.auth.limit,
      ttl: config.throttle.auth.ttl,
    },
  })
  @Post('identities/connect/confirm')
  @UseGuards(AuthGuard())
  @ApiOAuth2([])
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Connect the Ever ID to the signed-in account, after the person confirmed both emails' })
  @ApiResponse({ status: HttpStatus.OK, type: IdentityResponse, description: 'Connected' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Ever ID sign-in is off, or the record is invalid or expired' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'The connect was started by another account' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The identity is connected already' })
  async confirmConnectIdentity(@Req() req, @Body() payload: ConnectIdentityConfirmRequest) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });
    const pending = this.everIdSessions.unseal(payload.pending, 'connect');
    if (!pending) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'pending_invalid', 'The connection expired, please start again');
    }
    if (pending.userId !== requestingUser.id) {
      throw new AuthProviderException(HttpStatus.FORBIDDEN, 'pending_mismatch', 'This connection was started by another account');
    }
    this.assertOidcActive(pending.provider);
    await this.assertConnectable(requestingUser.id, pending.provider, pending.issuer, pending.subject);

    const identity = await this.everIdSessions.link(requestingUser.id, pending, IdentityLinkMethod.Explicit);
    if (!identity) {
      throw new AuthProviderException(HttpStatus.CONFLICT, 'subject_linked', 'This identity is connected to an account already');
    }
    const identities = await this.everIdSessions.listForUser(requestingUser.id);
    return { data: identities.find(item => item.id === identity.id) };
  }

  @Get('identities')
  @UseGuards(AuthGuard())
  @ApiOAuth2([])
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'List the sign-in identities (e.g. Ever ID) connected to the signed-in account' })
  @ApiResponse({ status: HttpStatus.OK, type: ListIdentitiesResponse, description: 'Success' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Ever ID sign-in is off' })
  async listIdentities(@Req() req) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });
    this.assertOidcActive(EVERID);
    return { data: await this.everIdSessions.listForUser(requestingUser.id) };
  }

  @Delete('identities/:id')
  @UseGuards(AuthGuard())
  @ApiOAuth2([])
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Disconnect a sign-in identity from the signed-in account' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Disconnected' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Ever ID sign-in is off' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such identity on this account' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The account would have no way left to sign in (last_sign_in_method)' })
  async deleteIdentity(@Req() req, @Param('id') id: string) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });
    this.assertOidcActive(EVERID);
    const result = await this.everIdSessions.unlink(requestingUser.id, id);
    if (result === 'not_found') {
      throw new NotFoundException('identity not found');
    }
    if (result === 'last_sign_in_method') {
      throw new AuthProviderException(
        HttpStatus.CONFLICT,
        'last_sign_in_method',
        'This is the only way to sign in to this account. Set a password first, e.g. with "Forgot password".',
      );
    }
  }

  @Throttle({
    default: {
      limit: config.throttle.auth.limit,
      ttl: config.throttle.auth.ttl,
    },
  })
  @Post('everid/backchannel-logout')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'OpenID Connect back-channel logout for Ever ID',
    description: 'Called by the issuer with a form-encoded logout_token: ends the Traduora sessions opened with that Ever ID session',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'The sessions are ended' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Off, or the logout token is invalid, too old or replayed' })
  async backchannelLogout(@Body() payload: BackchannelLogoutRequest): Promise<void> {
    if (!this.oidcProviders.isActive(EVERID) || !this.oidcProviders.isBackchannelLogoutEnabled(EVERID)) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'provider_disabled', 'Ever ID back-channel logout is off');
    }
    let logout: Awaited<ReturnType<OidcProviderService['verifyLogoutToken']>>;
    try {
      logout = await this.oidcProviders.verifyLogoutToken(EVERID, payload.logout_token);
    } catch (error) {
      this.logger.warn(`Back-channel logout refused: ${error instanceof OidcError ? error.code : 'invalid token'}`);
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'invalid_request', 'The logout token is not valid');
    }
    // Reserved before anything ends, so that a copy of the token can never end sessions opened later
    if (!(await this.everIdSessions.rememberLogoutJti(logout.jti))) {
      this.logger.warn('Back-channel logout refused: replayed token');
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'invalid_request', 'The logout token is not valid');
    }
    try {
      if (logout.sid) {
        await this.everIdSessions.revokeSid(logout.sid);
      } else {
        await this.everIdSessions.revokeIdentity(logout.issuer, logout.subject);
      }
    } catch (error) {
      // Forget the token id, so the issuer can send the same logout again
      await this.everIdSessions.releaseLogoutJti(logout.jti).catch(() => undefined);
      this.logger.error(`Back-channel logout could not end the sessions: ${error?.message ?? 'unexpected error'}`);
      throw new AuthProviderException(HttpStatus.SERVICE_UNAVAILABLE, 'temporarily_unavailable', 'Please try again');
    }
  }

  /** Answers 400 `provider_disabled` unless the OpenID Connect provider `slug` is on. */
  private assertOidcActive(slug: string): void {
    if (!this.oidcProviders.handles(slug) || !this.oidcProviders.isActive(slug)) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'provider_disabled', 'This sign-in provider is not enabled');
    }
  }

  /** Exchanges the code (with the PKCE verifier) and verifies the ID token against the nonce of the request. */
  private async verifyOidcCode(slug: string, payload: { code: string; nonce?: string; code_verifier?: string }): Promise<OidcIdentity> {
    this.assertOidcActive(slug);
    if (!payload.code || !payload.nonce || !payload.code_verifier) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'sign_in_failed', 'The code, nonce and code_verifier are required');
    }
    try {
      const { id_token } = await this.authService.getTokenFromProvider(slug, payload.code, payload.code_verifier);
      return await this.oidcProviders.verifyIdToken(slug, id_token, payload.nonce);
    } catch (error) {
      const code = error instanceof OidcError ? error.code : 'unexpected error';
      this.logger.warn(`Sign-in with ${slug} failed: ${code}`);
      if (error instanceof OidcError && error.code === 'email_unverified') {
        throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'email_unverified', 'Please verify your email with Ever ID first');
      }
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'sign_in_failed', 'The sign-in could not be completed, please try again');
    }
  }

  /** A connect needs an identity that is attached to no account, and an account without an identity of that provider. */
  private async assertConnectable(userId: string, provider: string, issuer: string, subject: string): Promise<void> {
    const existing = await this.everIdSessions.findIdentity(issuer, subject);
    if (existing) {
      throw existing.user?.id === userId
        ? new AuthProviderException(HttpStatus.CONFLICT, 'already_linked', 'This Ever ID is connected to your account already')
        : new AuthProviderException(HttpStatus.CONFLICT, 'subject_linked', 'This Ever ID is connected to another account');
    }
    if (await this.everIdSessions.hasIdentity(userId, provider)) {
      throw new AuthProviderException(HttpStatus.CONFLICT, 'already_linked', 'An Ever ID is connected to your account already');
    }
  }

  /** The invitations sent to an email and not accepted yet. */
  private pendingInvites(email: string): Promise<Invite[]> {
    return this.inviteRepo.find({
      where: { email: normalizeEmail(email), status: InviteStatus.Sent },
      relations: ['project'],
    });
  }

  /**
   * Signs an access token for a sign-in with an OpenID Connect provider. Like any user token, plus the provider's
   * session (`sid`), which a back-channel logout ends, and the token's own id (`jti`).
   */
  private async signOidcUserToken(user: User, providerSid: string | undefined): Promise<string> {
    const session = await this.everIdSessions.openSession(user.id, providerSid);
    if (!session) {
      throw new AuthProviderException(HttpStatus.BAD_REQUEST, 'session_ended', 'This Ever ID session has ended, please sign in again');
    }
    const tokenPayload: JwtPayload = { sub: user.id, type: 'user', sv: user.sessionVersion ?? 0, sid: session.sid, jti: session.jti };
    return this.jwtService.sign(tokenPayload);
  }
}
