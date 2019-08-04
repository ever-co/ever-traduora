import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2Auth, ApiOperation, ApiResponse, ApiUseTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';
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
} from '../domain/http';
import { ProjectClient } from '../entity/project-client.entity';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';

@Controller('api/v1/auth')
@ApiUseTags('Authentication')
export class AuthController {
  constructor(
    private mailService: MailService,
    private userService: UserService,
    private jwtService: JwtService,
    private authService: AuthorizationService,
    @InjectRepository(ProjectClient) private projectClientRepo: Repository<ProjectClient>,
  ) {}

  @Post('signup')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ title: 'Create a new user account' })
  @ApiResponse({ status: HttpStatus.OK, type: SignupResponse, description: 'User account created' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'A user with this email already exists' })
  async signup(@Body() payload: SignupRequest) {
    if (!config.signupsEnabled) {
      throw new ForbiddenException('Signups are disabled');
    }

    const user = await this.userService.create(payload.name, payload.email, payload.password);

    const tokenPayload: JwtPayload = { sub: user.id, type: 'user' };
    const token = this.jwtService.sign(tokenPayload);
    this.mailService.welcomeNewUser(user);

    return {
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        accessToken: token,
      },
    };
  }

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    title: 'Request an authentication token for an existing user or project client',
    description:
      'The grant type must be one of **password** or **client_credentials**.' +
      'When using a grant type of *password*, you must provide the fields *username* (email) and *password*.' +
      'When using the grant type *client_credentials* you must provide the fields *client_id* and *client_secret*',
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
      default:
        throw new BadRequestException('invalid grant type');
    }
  }

  private async authenticateUser(email, password) {
    const user = await this.userService.authenticate(email, password);
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

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ title: 'Request reset password email' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Email sent' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No user with such email found' })
  async forgotPassword(@Body() payload: ForgotPasswordRequest) {
    const { user, token } = await this.userService.forgotPassword(payload.email);
    this.mailService.passwordResetToken(user, token);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ title: 'Reset password from token' })
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
  @ApiOAuth2Auth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ title: 'Change password using current one' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Password changed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such resource found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async changePassword(@Req() req, @Body() payload: ChangePasswordRequest) {
    const requestingUser = this.authService.getRequestUserOrClient(req, { mustBeUser: true });
    const user = await this.userService.changePassword(requestingUser.id, payload.oldPassword, payload.newPassword);
    this.mailService.passwordChanged(user);
  }
}
