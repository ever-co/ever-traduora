import { Controller, Get, Req, UseGuards, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Locale } from '../entity/locale.entity';
import { ApiOAuth2Auth, ApiUseTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ListLocalesResponse } from '../domain/http';

@Controller('api/v1/locales')
@UseGuards(AuthGuard())
@ApiUseTags('Locales')
export default class LocaleController {
  constructor(@InjectRepository(Locale) private localeRepo: Repository<Locale>) {}

  @Get()
  @ApiOAuth2Auth()
  @ApiOperation({ title: 'List all available locales' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListLocalesResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req) {
    const locales = await this.localeRepo.find({ take: 1000 });
    return {
      data: locales.map(l => ({
        code: l.code,
        language: l.language,
        region: l.region,
      })),
    };
  }
}
