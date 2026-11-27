import { Controller, Get } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { version } from '../../package.json';
import { Access } from '../access/access.decorator';

@Controller()
export default class HealthController {
  @ApiExcludeEndpoint()
  @Access('public')
  @Get('/health')
  async health() {
    return { status: 'ok', version };
  }
}
