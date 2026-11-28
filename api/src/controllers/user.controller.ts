import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpdateUserDataRequest, UserInfoResponse } from '../domain/http';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';
import { verifyEmailUrl } from '../utils/email-verification-token';
import { Access } from '../access/access.decorator';
import { pendingAccountStep } from '../accounts/account-policy';

@Controller('api/v1/users')
@ApiOAuth2([])
@ApiTags('Users')
export default class UserController {
  constructor(
    private auth: AuthorizationService,
    private userService: UserService,
    private mail: MailService,
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

  @Access('user', { whilePending: true })
  @Patch('me')
  @ApiOperation({ summary: `Update the current user's profile` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: UserInfoResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(@Req() req, @Body() payload: UpdateUserDataRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
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
