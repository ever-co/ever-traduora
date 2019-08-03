import { Controller, Get } from '@nestjs/common';
import { ApiUseTags, ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller()
export default class HealthController {
  constructor() {}

  @ApiExcludeEndpoint()
  @Get('/health')
  async health() {
    return { status: 'ok' };
  }
}
