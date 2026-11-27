import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Header,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { User } from '../entity/user.entity';
import { EverConnectPersonService } from './ever-connect-person.service';
import { Access } from '../access/access.decorator';

/**
 * A signed-in user only (never an API client token): a signed-out caller gets 401, an API client 404, as for any
 * resource it may not see.
 */
@Injectable()
export class EverSignedInUserGuard extends AuthGuard('jwt') implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    await super.canActivate(context);
    const request = context.switchToHttp().getRequest();
    if (!(request?.user instanceof User) || !request.user.id) {
      throw new NotFoundException();
    }
    return true;
  }
}

/**
 * A person's own exports, made for an export request the person sent from app.ever.co
 * (`/api/v1/ever-connect/me/exports*`). Present only when the connection module is loaded. Each export answers the
 * account it was made of only, and only for 7 days.
 */
@Controller('api/v1/ever-connect/me')
@ApiTags('Ever Platform')
export class EverConnectPersonController {
  constructor(private readonly person: EverConnectPersonService) {}

  @Access('user', { apiKeys: 'not-found' })
  @Get('exports')
  @UseGuards(EverSignedInUserGuard)
  @ApiOAuth2([])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'The exports of the signed-in account that can be downloaded now' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  async listExports(@Req() req) {
    return { data: await this.person.listExports(req.user.id) };
  }

  @Access('user', { apiKeys: 'not-found' })
  @Get('exports/:jobId')
  @UseGuards(EverSignedInUserGuard)
  @ApiOAuth2([])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'One export of the signed-in account (its own data, as JSON)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such export for this account, or it expired' })
  async download(@Req() req, @Param('jobId') jobId: string) {
    return { data: await this.person.download(jobId, req.user.id) };
  }
}
