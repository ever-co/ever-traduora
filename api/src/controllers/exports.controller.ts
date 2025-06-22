import { BadRequestException, Controller, Get, HttpStatus, NotFoundException, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Request, Response } from 'express';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { IntermediateTranslationFormat } from '../domain/formatters';
import { ExportQuery, ImportExportFormat } from '../domain/http';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Term } from '../entity/term.entity';
import { csvExporter } from '../formatters/csv';
import { jsonFlatExporter } from '../formatters/jsonflat';
import { jsonNestedExporter } from '../formatters/jsonnested';
import { propertiesExporter } from '../formatters/properties';
import { xliffExporter } from '../formatters/xliff';
import { yamlFlatExporter } from '../formatters/yaml-flat';
import { yamlNestedExporter } from '../formatters/yaml-nested';
import AuthorizationService from '../services/authorization.service';
import { gettextExporter } from '../formatters/gettext';
import { stringsExporter } from '../formatters/strings';
import { phpExporter } from '../formatters/php';
import { ApiOAuth2, ApiTags, ApiOperation, ApiProduces, ApiResponse } from '@nestjs/swagger';
import { androidXmlExporter } from '../formatters/android-xml';
import { resXExporter } from '../formatters/resx';
import { merge } from 'lodash';
import { resolveColumnName } from '../utils/alias-helper';
import { getLexicalOrderClause } from '../utils/database-type-helper';

@Controller('api/v1/projects/:projectId/exports')
export class ExportsController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(ProjectLocale)
    private projectLocaleRepo: Repository<ProjectLocale>,
  ) {}

  @Get()
  @UseGuards(AuthGuard())
  @ApiTags('Exports')
  @ApiOAuth2([])
  @ApiOperation({ summary: `Export all translated terms for a project's locale` })
  @ApiProduces('application/octet-stream')
  @ApiResponse({ status: HttpStatus.OK, description: 'File exported' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async export(@Req() req: Request, @Res() res: Response, @Param('projectId') projectId: string, @Query() query: ExportQuery) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ExportTranslation);

    if (!query.locale) {
      throw new BadRequestException('locale is a required param');
    }

    // Ensure locale is requested project locale
    const projectLocale = await this.projectLocaleRepo.findOne({
      where: {
        project: {
          id: membership.project.id,
        },
        locale: {
          code: query.locale,
        },
      },
    });

    if (!projectLocale) {
      throw new NotFoundException('unknown locale code');
    }

    const queryBuilder = this.termRepo
      .createQueryBuilder('term')
      .leftJoinAndSelect('term.translations', 'translation', `translation.${resolveColumnName('projectLocaleId')} = :projectLocaleId`, {
        projectLocaleId: projectLocale.id,
      })
      .where(`term.${resolveColumnName('projectId')} = :projectId`, { projectId });

    queryBuilder.orderBy(getLexicalOrderClause('term.value'), 'ASC');

    if (query.untranslated) {
      queryBuilder.andWhere("translation.value = ''");
    }

    const termsWithTranslations = await queryBuilder.getMany();

    let termsWithTranslationsMapped = termsWithTranslations.map(t => ({
      term: t.value,
      translation: t.translations.length === 1 ? t.translations[0].value : '',
    }));

    if (query.fallbackLocale) {
      termsWithTranslationsMapped = termsWithTranslationsMapped.filter(t => t.translation !== '');
    }

    const data: IntermediateTranslationFormat = {
      iso: query.locale,
      translations: termsWithTranslationsMapped,
    };

    let serialized = await this.dump(query.format, data);

    if (query.fallbackLocale) {
      const fallbackProjectLocale = await this.projectLocaleRepo.findOne({
        where: {
          project: {
            id: membership.project.id,
          },
          locale: {
            code: query.fallbackLocale,
          },
        },
      });

      if (fallbackProjectLocale) {
        const fallbackQueryBuilder = this.termRepo
          .createQueryBuilder('term')
          .leftJoinAndSelect('term.translations', 'translation', `translation.${resolveColumnName('projectLocaleId')} = :projectLocaleId`, {
            projectLocaleId: fallbackProjectLocale.id,
          })
          .where(`term.${resolveColumnName('projectId')} = :projectId`, { projectId });

        fallbackQueryBuilder.orderBy(getLexicalOrderClause('term.value'), 'ASC');

        const fallbackTermsWithTranslations = await fallbackQueryBuilder.getMany();

        const fallbackTermsWithTranslationsMapped = fallbackTermsWithTranslations.map(t => ({
          term: t.value,
          translation: t.translations.length === 1 ? t.translations[0].value : '',
        }));

        const dataWithFallback: IntermediateTranslationFormat = {
          iso: query.locale,
          translations: merge(fallbackTermsWithTranslationsMapped, data.translations),
        };

        serialized = await this.dump(query.format, dataWithFallback);
      }
    }

    res.status(HttpStatus.OK);
    res.contentType('application/octet-stream');
    res.send(serialized);
  }

  private async dump(format: ImportExportFormat, data: IntermediateTranslationFormat): Promise<string | Buffer> {
    switch (format) {
      case 'androidxml':
        return await androidXmlExporter(data);
      case 'csv':
        return await csvExporter(data);
      case 'xliff12':
        return await xliffExporter({ version: '1.2' })(data);
      case 'jsonflat':
        return await jsonFlatExporter(data);
      case 'jsonnested':
        return await jsonNestedExporter(data);
      case 'yamlflat':
        return await yamlFlatExporter(data);
      case 'yamlnested':
        return await yamlNestedExporter(data);
      case 'properties':
        return await propertiesExporter(data);
      case 'po':
        return await gettextExporter(data);
      case 'strings':
        return await stringsExporter(data);
      case 'php':
        return await phpExporter(data);
      case 'resx':
        return await resXExporter(data);
      default:
        throw new Error('Export format not implemented');
    }
  }
}
