import { Controller, Get } from '@nestjs/common';
import { ApiUseTags } from '@nestjs/swagger';

@Controller()
@ApiUseTags('Misc')
export default class HealthController {
  constructor() {}

  @Get('/health')
  async health() {
    return { status: 'ok' };
  }
}
