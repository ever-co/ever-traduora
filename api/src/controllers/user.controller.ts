import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpdateUserDataRequest, UserInfoResponse } from '../domain/http';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';
import { verifyEmailUrl } from '../utils/email-verification-token';
import { Access } from '../access/access.decorator';
import { pendingAccountStep } from '../accounts/account-policy';
import { AttemptLimiter, HOUR_MS } from '../accounts/attempt-limiter';
import { config } from '../config';
import { normalizeEmail } from '../domain/validators';

@Controller('api/v1/users')
@ApiOAuth2([])
@ApiTags('Users')
export default class UserController {
  constructor(
    private auth: AuthorizationService,
    private userService: UserService,
    private mail: MailService,
    private attempts: AttemptLimiter,
  ) {}

  @Access('user', { whilePending: true })
  @Get('me')
  @ApiOperation({ summary: `Get the current user's profile` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: UserInfoResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async me(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    // What the account must still do before the app works for it (confirm the e-mail, accept the terms), or null
    return { data: { ...user, pending: pendingAccountStep(user) ?? null } };
  }

  // A change of e-mail sends a confirmation email: the auth rate limit per address, and a cap per account below
  @Throttle({
    default: {
      limit: config.throttle.auth.limit,
      ttl: config.throttle.auth.ttl,
    },
  })
  @Access('user', { whilePending: true })
  @Patch('me')
  @ApiOperation({ summary: `Update the current user's profile` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: UserInfoResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'More than TR_VERIFICATION_EMAILS_PER_HOUR confirmation emails for this account',
  })
  async update(@Req() req, @Body() payload: UpdateUserDataRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    if (payload.email && normalizeEmail(payload.email) !== user.email) {
      // Each new address gets a confirmation email, to an address the caller chose: at most so many per account and hour
      await this.attempts.count('verification-email', user.id, config.throttle.verificationEmailsPerHour, HOUR_MS);
    }
    const { user: updated, emailChanged } = await this.userService.updateUserData(user.id, payload);

    // A new email starts unverified, so ask the owner to confirm it
    if (emailChanged) {
      const token = await this.userService.startEmailVerification(updated);
      if (token) {
        void this.mail.verifyEmail(updated, verifyEmailUrl(token));
      }
    }

    return {
      data: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        emailVerified: updated.emailVerified,
      },
    };
  }

  @Access('user', { whilePending: true })
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: `Delete the current user's account` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.UNPROCESSABLE_ENTITY, description: 'Cannot delete account' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.userService.deleteAccount(user);
  }
}
