import { Controller, Get, HttpStatus, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import * as _ from 'lodash';
import { Repository } from 'typeorm';
import { config } from '../config';
import { ProjectAction } from '../domain/actions';
import { ProjectStatsResponse } from '../domain/http';
import { Locale } from '../entity/locale.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import AuthorizationService from '../services/authorization.service';

@Controller('api/v1/projects/:projectId/stats')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Project Stats')
export default class ProjectStatsController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Translation) private translationRepo: Repository<Translation>,
    @InjectRepository(ProjectLocale) private projectLocaleRepo: Repository<ProjectLocale>,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(Locale) private localeRepo: Repository<Locale>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get stats for project' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ProjectStatsResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async getStats(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTranslation);
    const locales = await this.projectLocaleRepo.find({
      where: {
        project: { id: membership.project.id },
      },
      relations: ['locale'],
    });

    const termCount = membership.project.termsCount;

    // TypeORM fails to properly quote camelCase aliases with PostgreSQL
    // https://github.com/typeorm/typeorm/issues/10961
    const useSnakeCase = config.db.default.type === 'postgres';

    const projectLocale = useSnakeCase ? 'project_locale' : 'projectLocale';

    const translatedByLocale = await this.projectLocaleRepo
      .createQueryBuilder(projectLocale)
      .leftJoin(`${projectLocale}.translations`, 'translations')
      .select(`${projectLocale}.${useSnakeCase ? 'locale_code' : 'localeCode'}`, 'localeCode')
      .addSelect('count(*)', 'translated')
      .groupBy(`${projectLocale}.${useSnakeCase ? 'locale_code' : 'localeCode'}`)
      .whereInIds(locales.map(l => l.id))
      .andWhere("translations.value <> ''")
      .execute();

    const stats = translatedByLocale.map(s => {
      const translatedCount = parseInt(s.translated, 10);
      return {
        localeCode: s.localeCode,
        progress: Math.floor((translatedCount / termCount) * 100) / 100,
        translated: translatedCount,
        total: termCount,
      };
    });

    const statsByLocale = _.chain(stats).keyBy('localeCode').value();

    const defaultStats = {
      progress: 0,
      translated: 0,
      total: termCount,
    };

    const withDefaults = locales.map(locale => {
      const localeCode = locale.locale.code;
      const statsForLocale = statsByLocale[localeCode];
      return statsForLocale ? statsForLocale : { ...defaultStats, localeCode };
    });

    const localeStats = _.chain(withDefaults)
      .keyBy('localeCode')
      .mapValues(v => _.omit(v, 'localeCode'))
      .value();

    const totalTranslated = _.sumBy(withDefaults, 'translated');
    const localeCount = locales.length;
    const totalTerms = localeCount > 0 ? termCount * localeCount : termCount;
    const totalProgress = totalTerms > 0 ? Math.floor((totalTranslated / totalTerms) * 100) / 100 : 0;

    const projectStats = {
      progress: totalProgress,
      translated: totalTranslated,
      total: totalTerms,
      terms: termCount,
      locales: localeCount,
    };

    return {
      data: {
        projectStats,
        localeStats,
      },
    };
  }
}
