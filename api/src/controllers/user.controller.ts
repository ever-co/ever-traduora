import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Patch, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { UpdateUserDataRequest } from '../domain/http';
import AuthorizationService from '../services/authorization.service';
import { UserService } from '../services/user.service';

@Controller('api/v1/users')
@UseGuards(AuthGuard())
export default class UserController {
  constructor(private auth: AuthorizationService, private userService: UserService) {}

  @Get('me')
  async me(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    return { data: user };
  }

  @Patch('me')
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
  async delete(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.userService.deleteAccount(user);
  }
}
