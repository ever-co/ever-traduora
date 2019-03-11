import { Controller, Get } from '@nestjs/common';

@Controller()
export default class HealthController {
  constructor() {}

  @Get('/health')
  async health() {
    return { status: 'ok' };
  }
}
