import { Controller, Get, Res } from '@nestjs/common';
import { resolve } from 'path';
import { config } from '../config';
import { ApiUseTags } from '@nestjs/swagger';

@Controller()
@ApiUseTags('Misc')
export default class IndexController {
  @Get('*')
  async index(@Res() res) {
    res.sendFile(resolve(config.publicDir, 'index.html'));
  }
}
