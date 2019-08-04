import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UpdateUserDataRequest, UserInfoResponse } from '../domain/http';
import AuthorizationService from '../services/authorization.service';
import { UserService } from '../services/user.service';
import { ApiBearerAuth, ApiUseTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('api/v1/users')
@UseGuards(AuthGuard())
@ApiBearerAuth()
@ApiUseTags('Users')
export default class UserController {
  constructor(private auth: AuthorizationService, private userService: UserService) {}

  @Get('me')
  @ApiOperation({ title: "Get the current user's profile" })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: UserInfoResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async me(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    return { data: user };
  }

  @Patch('me')
  @ApiOperation({ title: "Update the current user's profile" })
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
  @ApiOperation({ title: "Delete the current user's account" })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.UNPROCESSABLE_ENTITY, description: 'Cannot delete account' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.userService.deleteAccount(user);
  }
}
