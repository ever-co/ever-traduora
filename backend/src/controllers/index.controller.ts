import { Controller, Get, Res } from '@nestjs/common';
import { resolve } from 'path';
import { config } from '../config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

@Controller()
export default class IndexController {
  @Get('*')
  @ApiExcludeEndpoint()
  async index(@Res() res) {
    res.sendFile(resolve(config.publicDir, 'index.html'));
  }
}
