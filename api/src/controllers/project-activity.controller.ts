import { BadRequestException, Controller, Get, HttpStatus, NotFoundException, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { ListProjectActivityResponse } from '../domain/http';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Term } from '../entity/term.entity';
import { TranslationHistory } from '../entity/translation-history.entity';
import AuthorizationService from '../services/authorization.service';
import { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, parseHistoryLimit } from './translation.controller';

/**
 * The recent changes made to the translations of a project, across all its terms and locales, newest first:
 * who changed which term in which locale, from what to what. The per-translation list is
 * `GET /projects/:projectId/translations/:localeCode/history`.
 */
@Controller('api/v1/projects/:projectId/activity')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Translations')
export default class ProjectActivityController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(ProjectLocale) private projectLocaleRepo: Repository<ProjectLocale>,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(TranslationHistory) private historyRepo: Repository<TranslationHistory>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List the latest changes made to the translations of a project, newest first' })
  @ApiQuery({ name: 'locale', required: false, description: 'Only the changes made in the locale with this code' })
  @ApiQuery({ name: 'limit', required: false, description: `Between 1 and ${MAX_HISTORY_LIMIT}, ${DEFAULT_HISTORY_LIMIT} by default` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListProjectActivityResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string, @Query('limit') limit?: string, @Query('locale') locale?: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTranslation);

    // The query parser gives ?locale=fr&locale=de and ?locale[]=fr as an array, ?locale[x]=fr as an object
    if (locale !== undefined && typeof locale !== 'string') {
      throw new BadRequestException('locale must be one locale code');
    }

    const projectLocales = await this.projectLocaleRepo.find({
      where: { project: { id: membership.project.id } },
      relations: ['locale'],
    });

    const filtered = typeof locale === 'string' && locale.length > 0;
    const wanted = filtered ? projectLocales.filter(projectLocale => projectLocale.locale.code === locale) : projectLocales;
    if (filtered && wanted.length === 0) {
      throw new NotFoundException('project locale not found');
    }
    if (wanted.length === 0) {
      return { data: [] };
    }

    const entries = await this.historyRepo.find({
      where: { projectLocaleId: In(wanted.map(projectLocale => projectLocale.id)) },
      relations: ['user'],
      // The time first; the change number breaks ties within one translation, as times can tie
      order: { date: { created: 'DESC' }, revision: 'DESC' },
      take: parseHistoryLimit(limit),
    });
    if (entries.length === 0) {
      return { data: [] };
    }

    const codes = new Map(wanted.map(projectLocale => [projectLocale.id, projectLocale.locale.code]));
    const terms = await this.termRepo.find({
      where: { project: { id: membership.project.id }, id: In([...new Set(entries.map(entry => entry.termId))]) },
    });
    const keys = new Map(terms.map(term => [term.id, term.value]));

    return {
      data: entries.map(entry => ({
        id: entry.id,
        termId: entry.termId,
        term: keys.get(entry.termId) ?? '',
        locale: codes.get(entry.projectLocaleId) ?? '',
        revision: entry.revision,
        previousValue: entry.previousValue,
        value: entry.value,
        user: entry.user ? { id: entry.user.id, name: entry.user.name } : undefined,
        date: entry.date.created,
      })),
    };
  }
}
