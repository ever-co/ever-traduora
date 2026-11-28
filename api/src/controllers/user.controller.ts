import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpdateUserDataRequest, UserInfoResponse } from '../domain/http';
import { AccountDeletionPlanResponse, DeleteAccountRequest } from '../operator/operator.dto';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { UserService } from '../services/user.service';
import { verifyEmailUrl } from '../utils/email-verification-token';
import { Access } from '../access/access.decorator';

@Controller('api/v1/users')
@ApiOAuth2([])
@ApiTags('Users')
export default class UserController {
  constructor(
    private auth: AuthorizationService,
    private userService: UserService,
    private mail: MailService,
  ) {}

  @Access('user')
  @Get('me')
  @ApiOperation({ summary: `Get the current user's profile` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: UserInfoResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async me(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    return { data: user };
  }

  @Access('user')
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

  @Access('user')
  @Get('me/deletion')
  @ApiOperation({
    summary: `What stands in the way of deleting the current user's account`,
    description:
      'Projects they are the last admin of while others use them, and organizations they own: the choices DELETE /users/me ' +
      'takes (a new project admin, a new owner, or deleting an organization they are alone in).',
  })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: AccountDeletionPlanResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async deletionPlan(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    return { data: await this.userService.deletionPlan(user) };
  }

  @Access('user')
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: `Delete the current user's account`,
    description:
      'Without a body, as before. The body hands the admin role of projects and the ownership of organizations to other ' +
      'members, and deletes organizations the user is alone in, confirmed with their slug (see GET /users/me/deletion).',
  })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'A choice that cannot be made (transfer_invalid, slug_mismatch)' })
  @ApiResponse({
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    description: 'Cannot delete account: a project or an organization needs a new admin or owner',
  })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Body() payload?: DeleteAccountRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.userService.deleteAccount(user, payload ?? {});
  }
}
