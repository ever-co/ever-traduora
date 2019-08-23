import { Controller, Get } from '@nestjs/common';
import { ApiUseTags, ApiExcludeEndpoint } from '@nestjs/swagger';
import { version } from '../../package.json';

@Controller()
export default class HealthController {
  constructor() {}

  @ApiExcludeEndpoint()
  @Get('/health')
  async health() {
    return { status: 'ok', version };
  }
}
