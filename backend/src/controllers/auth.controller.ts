import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
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
import { Repository } from 'typeorm';
import { Throttle } from '@nestjs/throttler';
import { config } from '../config';
import {
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
} from '../domain/http';
import { normalizeEmail } from '../domain/validators';
import { Invite, InviteStatus } from '../entity/invite.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectUser } from '../entity/project-user.entity';
import { AuthService } from '../services/auth.service';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';

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
  async signup(@Body() payload: SignupRequest) {
    const normalizedEmail = normalizeEmail(payload.email);

    // check for invite
    const invites = await this.inviteRepo.find({
      where: { email: normalizedEmail, status: InviteStatus.Sent },
      relations: ['project'],
    });

    // Early exit if the user has no invitation and sign up is disabled.
    if (invites.length === 0 && !config.signupsEnabled) {
      throw new ForbiddenException('Signups are invitation based only.');
    }

    const { user, isNewUser } = await this.userService.create({ grantType: GrantType.Password, ...payload });

    if (invites.length > 0) {
      // accept project invites
      await this.inviteRepo.manager.transaction(async entityManager => {
        invites.forEach(invite => (invite.status = InviteStatus.Accepted));
        await entityManager.save(invites);

        const projectUsers = invites.map(invite => {
          return entityManager.create(ProjectUser, {
            project: { id: invite.project.id },
            user: user,
            role: invite.role,
          });
        });
        await entityManager.save(projectUsers);
      });
    }

    const tokenPayload: JwtPayload = { sub: user.id, type: 'user' };
    const token = this.jwtService.sign(tokenPayload);

    if (isNewUser) {
      this.mailService.welcomeNewUser(user);
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

  @Post('signup-provider')
  async signupWithProvider(@Body() { code }: { code: string }): Promise<{ data: { id: string; email: string; name: string; accessToken: string } }> {
    const { id_token } = await this.authService.getTokenFromGoogle(code);
    const decodedToken = this.jwtService.decode(id_token, { json: true }) as { email: string; name: string };

    const normalizedEmail = normalizeEmail(decodedToken.email);

    // check for invite
    const invites = await this.inviteRepo.find({
      where: { email: normalizedEmail, status: InviteStatus.Sent },
      relations: ['project'],
    });

    // This endpoint can be used for signing in too in the case of providers.
    // Ensure that we forbid a new account if we have disabled signups.
    // But still allow logging in in case the account had already been created.
    if (!config.signupsEnabled && invites.length === 0 && !(await this.userService.userExists(decodedToken.email))) {
      throw new ForbiddenException('Signups are invitation based only.');
    }

    const { user, isNewUser } = await this.userService.create({ grantType: GrantType.Provider, name: decodedToken.name, email: decodedToken.email });

    if (invites.length > 0) {
      // accept project invites
      await this.inviteRepo.manager.transaction(async entityManager => {
        invites.forEach(invite => (invite.status = InviteStatus.Accepted));
        await entityManager.save(invites);

        const projectUsers = invites.map(invite => {
          return entityManager.create(ProjectUser, {
            project: { id: invite.project.id },
            user: user,
            role: invite.role,
          });
        });
        await entityManager.save(projectUsers);
      });
    }

    const tokenPayload: JwtPayload = { sub: user.id, type: 'user' };
    const token = this.jwtService.sign(tokenPayload);

    if (isNewUser) {
      this.mailService.welcomeNewUser(user);
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
    const tokenPayload: JwtPayload = { sub: user.id, type: 'user' };
    const token = this.jwtService.sign(tokenPayload);
    return token;
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

    const tokenPayload: JwtPayload = { sub: user.id, type: 'user' };
    const token = this.jwtService.sign(tokenPayload);
    return token;
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
}
