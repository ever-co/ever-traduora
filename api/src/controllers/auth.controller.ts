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
} from '../domain/http';
import { ProjectClient } from '../entity/project-client.entity';
import { AuthService } from '../services/auth.service';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private mailService: MailService,
    private userService: UserService,
    private jwtService: JwtService,
    private authorizationService: AuthorizationService,
    @InjectRepository(ProjectClient) private projectClientRepo: Repository<ProjectClient>,
    private authService: AuthService,
  ) {}

  @Get('providers')
  @HttpCode(HttpStatus.OK)
  async getProviders(): Promise<{ data: { url: string; redirectUrl: string; clientId: string }[] }> {
    return {
      data: Object.keys(config.providers).reduce((acc, provider) => {
        const { url, active, redirectUrl, clientId } = config.providers[provider];
        return active ? [...acc, { url, redirectUrl, clientId }] : acc;
      }, []),
    };
  }

  @Post('signup')
  @HttpCode(HttpStatus.OK)
  async signup(@Body() payload: SignupRequest): Promise<{ data: { id: string; email: string; name: string; accessToken: string } }> {
    if (!config.signupsEnabled) {
      throw new ForbiddenException('Signups are disabled');
    }

    const user = await this.userService.create({ grantType: GrantType.Password, ...payload });

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

  @Post('signup-provider')
  async signupWithProvider(@Body() { code }: { code: string }): Promise<{ data: { id: string; email: string; name: string; accessToken: string } }> {
    if (!config.signupsEnabled) {
      throw new ForbiddenException('Signups are disabled');
    }

    const { id_token } = await this.authService.getTokenFromGoogle(code);

    const decodedToken = this.jwtService.decode(id_token, { json: true }) as { email: string; name: string };

    const user = await this.userService.create({ grantType: GrantType.Provider, name: decodedToken.name, email: decodedToken.email });

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
  async forgotPassword(@Body() payload: ForgotPasswordRequest) {
    const { user, token } = await this.userService.forgotPassword(payload.email);
    this.mailService.passwordResetToken(user, token);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() payload: ResetPasswordRequest) {
    const user = await this.userService.resetPassword(payload.email, payload.token, payload.newPassword);

    this.mailService.passwordChanged(user);
  }

  @Post('change-password')
  @UseGuards(AuthGuard())
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Req() req, @Body() payload: ChangePasswordRequest) {
    const requestingUser = this.authorizationService.getRequestUserOrClient(req, { mustBeUser: true });
    const user = await this.userService.changePassword(requestingUser.id, payload.oldPassword, payload.newPassword);
    this.mailService.passwordChanged(user);
  }
}
