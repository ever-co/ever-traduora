import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { UpdateUserDataRequest, UserInfoResponse } from '../domain/http';
import AuthorizationService from '../services/authorization.service';
import { UserService } from '../services/user.service';

@Controller('api/v1/users')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Users')
export default class UserController {
  constructor(private auth: AuthorizationService, private userService: UserService) {}

  @Get('me')
  @ApiOperation({ summary: `Get the current user's profile` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: UserInfoResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async me(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    return { data: user };
  }

  @Patch('me')
  @ApiOperation({ summary: `Update the current user's profile` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: UserInfoResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(@Req() req, @Body() payload: UpdateUserDataRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const updated = await this.userService.updateUserData(user.id, payload);
    return {
      data: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
      },
    };
  }

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
