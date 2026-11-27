import { Controller, Get, Req, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Locale } from '../entity/locale.entity';
import { ApiOAuth2, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ListLocalesResponse } from '../domain/http';
import { Access } from '../access/access.decorator';

@Controller('api/v1/locales')
@ApiTags('Locales')
export default class LocaleController {
  constructor(@InjectRepository(Locale) private localeRepo: Repository<Locale>) {}

  @Access('user', { apiKeys: 'allowed' })
  @Get()
  @ApiOAuth2([])
  @ApiOperation({ summary: 'List all available locales' })
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
