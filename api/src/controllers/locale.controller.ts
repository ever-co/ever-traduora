import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Locale } from '../entity/locale.entity';

@Controller('api/v1/locales')
@UseGuards(AuthGuard())
export default class LocaleController {
  constructor(@InjectRepository(Locale) private localeRepo: Repository<Locale>) {}

  @Get()
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
