import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import * as _ from 'lodash';
import { EntityManager, Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import {
  AddLocaleRequest,
  ListProjectLocalesResponse,
  ListTermTranslatonsResponse,
  ListTranslationHistoryResponse,
  ProjectLocaleResponse,
  TermTranslatonResponse,
  UpdateTranslationRequest,
} from '../domain/http';
import { Locale } from '../entity/locale.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { TranslationHistory } from '../entity/translation-history.entity';
import { Translation } from '../entity/translation.entity';
import { User } from '../entity/user.entity';
import AuthorizationService from '../services/authorization.service';
import { lockProject } from '../utils/database-locks';
import { DbType, isDbType } from '../utils/database-type-helper';

const editLocks = new Map<string, Promise<unknown>>();

/** Runs the work after every earlier work with the same key, one at a time, whether or not the earlier work failed */
async function withEditLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = editLocks.get(key) ?? Promise.resolve();
  const run = previous.then(work);
  const tail = run.catch(() => undefined);
  editLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (editLocks.get(key) === tail) {
      editLocks.delete(key);
    }
  }
}

export const DEFAULT_HISTORY_LIMIT = 50;
export const MAX_HISTORY_LIMIT = 100;

/** The number of history entries to return: a whole number from 1 to the maximum, the default when absent or not a number */
export function parseHistoryLimit(raw: unknown): number {
  const value = typeof raw === 'string' && /^\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isSafeInteger(value)) {
    return DEFAULT_HISTORY_LIMIT;
  }
  return Math.min(Math.max(value, 1), MAX_HISTORY_LIMIT);
}

@Controller('api/v1/projects/:projectId/translations')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Translations')
export default class TranslationController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Translation) private translationRepo: Repository<Translation>,
    @InjectRepository(ProjectLocale) private projectLocaleRepo: Repository<ProjectLocale>,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(Locale) private localeRepo: Repository<Locale>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(TranslationHistory) private historyRepo: Repository<TranslationHistory>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List all translation locales for a project' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListProjectLocalesResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTranslation);
    const locales = await this.projectLocaleRepo.find({
      where: {
        project: { id: membership.project.id },
      },
      relations: ['locale'],
    });

    return {
      data: _.chain(locales)
        .map(v => _.pick(v, ['id', 'date', 'locale.code', 'locale.region', 'locale.language']))
        .value(),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a new translation locale for a project' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectLocaleResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.PAYMENT_REQUIRED, description: 'Plan limit reached' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Param('projectId') projectId: string, @Body() payload: AddLocaleRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.AddTranslation, 0, 1);

    const locale = await this.localeRepo.findOneBy({ code: payload.code });

    if (!locale) {
      throw new NotFoundException('unknown locale code');
    }

    const projectLocale = this.projectLocaleRepo.create({
      locale: locale,
      project: membership.project,
    });

    await this.termRepo.manager.transaction(async entityManager => {
      await lockProject(entityManager, membership.project.id);
      await entityManager.save(projectLocale);
      const terms = await entityManager.find(Term, { where: { project: { id: projectId } }, relations: ['labels'] });
      const translations = terms.map(term =>
        this.translationRepo.create({
          projectLocale: projectLocale,
          term: term,
          value: '',
          labels: term.labels,
        }),
      );
      await entityManager.save(translations);
      await entityManager.increment(Project, { id: membership.project.id }, 'localesCount', 1);
    });

    const result = await this.projectLocaleRepo.findOneByOrFail({
      locale: {
        code: locale.code,
      },
      project: { id: membership.project.id },
    });

    return {
      data: {
        id: result.id,
        locale: {
          code: projectLocale.locale.code,
          region: projectLocale.locale.region,
          language: projectLocale.locale.language,
        },
        date: result.date,
      },
    };
  }

  @Get(':localeCode')
  @ApiOperation({ summary: `List translated terms for a locale` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListTermTranslatonsResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async findOne(@Req() req, @Param('projectId') projectId: string, @Param('localeCode') localeCode: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTranslation);

    try {
      // Ensure locale is requested project locale
      const projectLocale = await this.projectLocaleRepo.findOneOrFail({
        where: {
          project: { id: membership.project.id },
          locale: {
            code: localeCode,
          },
        },
      });
      try {
        const translations = await this.translationRepo.find({
          where: {
            projectLocale: {
              id: projectLocale.id,
            },
          },
          relations: ['term', 'labels'],
        });
        const result = translations.filter(t => !!t.term).map(t => ({ termId: t.term.id, value: t.value, labels: t.labels, date: t.date }));
        return { data: result };
      } catch (error) {
        throw new NotFoundException('project translation not found');
      }
    } catch (error) {
      throw new NotFoundException('project locale not found');
    }
  }

  @Patch(':localeCode')
  @ApiOperation({ summary: `Update a term's translation` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: TermTranslatonResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('localeCode') localeCode: string,
    @Body() payload: UpdateTranslationRequest,
  ) {
    const user = this.auth.getRequestUserOrClient(req);
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditTranslation);

    let projectLocale: ProjectLocale;
    try {
      projectLocale = await this.projectLocaleRepo.findOneOrFail({
        where: {
          locale: {
            code: localeCode,
          },
          project: {
            id: projectId,
          },
        },
      });
    } catch (error) {
      throw new NotFoundException('project locale not found');
    }

    let term: Term;
    try {
      term = await this.termRepo.findOneOrFail({
        where: {
          project: { id: projectId },
          id: payload.termId,
        },
        relations: ['labels'],
      });
    } catch (error) {
      throw new NotFoundException('project term not found');
    }

    const translation = await this.saveTranslation(projectLocale, term, payload.value, user instanceof User ? user : null);
    return {
      data: {
        termId: term.id,
        value: translation.value,
        labels: translation.labels,
        date: translation.date,
      },
    };
  }

  /**
   * Saves the value and the record of the change in one transaction, as one step that no other edit of the same
   * translation can interleave with: the previous value is read, the new one saved and the history written while the
   * translation is locked. Within this process the lock is a queue per translation; on databases other than SQLite the
   * transaction also holds a row lock, which serializes edits across several API instances too. SQLite has a single
   * connection that TypeORM shares between transactions, so two transactions open at once would nest into each other:
   * there, every edit waits for the one before it. Elsewhere the edit also holds its locale and its term locked for
   * share, in that order and before the translation: it waits for an import into that locale and for a delete of the
   * term to commit, and they wait for it. A locale or term deleted meanwhile is not found.
   */
  private saveTranslation(projectLocale: ProjectLocale, term: Term, value: string, user: User | null): Promise<Translation> {
    const where = { termId: term.id, projectLocaleId: projectLocale.id };
    const useRowLock = !isDbType(DbType.BETTER_SQLITE3);
    const key = useRowLock ? `${projectLocale.id}:${term.id}` : 'sqlite';

    return withEditLock(key, () =>
      this.translationRepo.manager.transaction(async (em: EntityManager) => {
        const share = useRowLock ? { lock: { mode: 'pessimistic_read' as const } } : {};
        if (!(await em.findOne(ProjectLocale, { where: { id: projectLocale.id }, ...share }))) {
          throw new NotFoundException('project locale not found');
        }
        if (!(await em.findOne(Term, { where: { id: term.id }, ...share }))) {
          throw new NotFoundException('project term not found');
        }
        const locked = await em.findOne(Translation, { where, ...(useRowLock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
        const previousValue = locked?.value ?? '';

        if (!locked) {
          await em.save(
            em.create(Translation, {
              value,
              projectLocale,
              term,
              labels: term.labels, // Copy term labels on creation
            }),
          );
        } else if (previousValue !== value) {
          await em.update(Translation, where, { value });
        }

        if (previousValue !== value) {
          const latest = await em.findOne(TranslationHistory, { where, order: { revision: 'DESC' } });
          await em.save(em.create(TranslationHistory, { ...where, revision: (latest?.revision ?? 0) + 1, previousValue, value, user }));
        }

        return em.findOneOrFail(Translation, { where, relations: ['labels'] });
      }),
    );
  }

  @Get(':localeCode/history')
  @ApiOperation({ summary: `List the changes made to a term's translation, newest first` })
  @ApiQuery({ name: 'termId', required: true })
  @ApiQuery({ name: 'limit', required: false, description: `Between 1 and ${MAX_HISTORY_LIMIT}, ${DEFAULT_HISTORY_LIMIT} by default` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListTranslationHistoryResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async history(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('localeCode') localeCode: string,
    @Query('termId') termId: string,
    @Query('limit') limit?: string,
  ) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTranslation);

    if (typeof termId !== 'string' || termId.length === 0) {
      throw new BadRequestException('termId is required');
    }

    const projectLocale = await this.projectLocaleRepo.findOne({
      where: { project: { id: membership.project.id }, locale: { code: localeCode } },
    });
    if (!projectLocale) {
      throw new NotFoundException('project locale not found');
    }

    const entries = await this.historyRepo.find({
      where: { termId, projectLocaleId: projectLocale.id },
      relations: ['user'],
      // The change number, not the time: the time can tie for edits made within the same second
      order: { revision: 'DESC' },
      take: parseHistoryLimit(limit),
    });

    return {
      data: entries.map(entry => ({
        id: entry.id,
        termId: entry.termId,
        revision: entry.revision,
        previousValue: entry.previousValue,
        value: entry.value,
        user: entry.user ? { id: entry.user.id, name: entry.user.name } : undefined,
        date: entry.date.created,
      })),
    };
  }

  @Delete(':localeCode')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: `Delete a project's locale`, description: `Deletes a project's locale and all related translations` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('localeCode') localeCode: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.DeleteTranslation);

    await this.projectLocaleRepo.manager.transaction(async entityManager => {
      await lockProject(entityManager, membership.project.id);
      const projectLocale = await entityManager.findOneOrFail(ProjectLocale, {
        where: {
          project: { id: membership.project.id },
          locale: {
            code: localeCode,
          },
        },
      });
      await entityManager.remove(projectLocale);
      await entityManager.decrement(Project, { id: membership.project.id }, 'localesCount', 1);
    });
  }
}
