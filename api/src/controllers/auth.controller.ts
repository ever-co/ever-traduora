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
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { Repository } from 'typeorm';

import { config } from '../config';
import {
  AuthenticateRequest,
  ChangePasswordRequest,
  ForgotPasswordRequest,
  GrantType,
  JwtPayload,
  ResetPasswordRequest,
  SignupRequest,
  SignupResponse,
  AccessTokenResponse,
} from '../domain/http';
import { ProjectClient } from '../entity/project-client.entity';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';
import { ApiBearerAuth, ApiUseTags, ApiResponse, ApiResponseModelProperty, ApiModelProperty, ApiOperation } from '@nestjs/swagger';

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
  @ApiOperation({ title: 'Sign up' })
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
    title: 'Request Authentication Token',
    description:
      'The grant type must be one of **password** or **clientCredentials**.' +
      'When using a grant type of *password*, you must provide the fields *email* and *password*.' +
      'When using the grant type *clientCredentials* you must provide the fields *clientId* and *clientSecret*',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Successfully authenticated', type: AccessTokenResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No resource with such credentials found' })
  @ApiResponse({ status: HttpStatus.TOO_MANY_REQUESTS, description: 'Too many attempts, please wait at least 15 minutes before retrying' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Bad credentials' })
  async token(@Body() payload: AuthenticateRequest) {
    switch (payload.grantType) {
      case GrantType.Password: {
        if (!payload.email || !payload.password) {
          throw new BadRequestException('missing credentials');
        }
        const token = await this.authenticateUser(payload.email, payload.password);
        return { data: { accessToken: token } };
      }
      case GrantType.ClientCredentials: {
        if (!payload.clientId || !payload.clientSecret) {
          throw new BadRequestException('missing credentials');
        }
        const token = await this.authenticateClient(payload.clientId, payload.clientSecret);
        return { data: { accessToken: token } };
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
  @ApiBearerAuth()
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
