import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Locale } from '../entity/locale.entity';
import { ApiBearerAuth, ApiUseTags } from '@nestjs/swagger';

@Controller('api/v1/locales')
@UseGuards(AuthGuard())
@ApiUseTags('Locales')
export default class LocaleController {
  constructor(@InjectRepository(Locale) private localeRepo: Repository<Locale>) {}

  @Get()
  @ApiBearerAuth()
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
