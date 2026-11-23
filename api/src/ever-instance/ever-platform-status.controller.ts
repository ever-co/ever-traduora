import { Controller, Get, HttpStatus, UseGuards } from '@nestjs/common';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { config } from '../config';
import { EverAdminGuard } from './ever-admin.guard';

/**
 * Which Ever Platform pages the operator of the installation has: the web app shows its menu entry only when this
 * answers. Present whenever one of the optional modules is loaded; nobody else gets an answer.
 */
@Controller('api/v1/ever-platform')
@ApiTags('Ever Platform')
export class EverPlatformStatusController {
  @Get('status')
  @UseGuards(EverAdminGuard)
  @ApiOAuth2([])
  @ApiOperation({ summary: 'The Ever Platform pages of this installation (instance operator only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success' })
  status() {
    return { data: { stats: config.everPlatform.statsEnabled, connect: config.everPlatform.connectEnabled } };
  }
}
