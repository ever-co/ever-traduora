import { Body, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import * as _ from 'lodash';
import { EntityManager, Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { AddLabelRequest, ProjectLabelResponse, UpdateLabelRequest } from '../domain/http';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Label } from '../entity/label.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import AuthorizationService from '../services/authorization.service';
import { isUniqueViolation } from '../services/ever-id-session.service';
import {
  lockProjectForShare,
  lockTerm,
  readCommittedTransaction,
  translationEditLockKey,
  withEditLock,
  withTermLabelEditLock,
} from '../utils/database-locks';
import { DbType, isDbType } from '../utils/database-type-helper';

@Controller('api/v1/projects/:projectId/labels')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Project Labels')
export default class ProjectLabelController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Label) private labelRepo: Repository<Label>,
    @InjectRepository(Term) private termsRepo: Repository<Term>,
    @InjectRepository(ProjectLocale) private projectLocaleRepo: Repository<ProjectLocale>,
    @InjectRepository(Translation) private translationsRepo: Repository<Translation>,
  ) {}

  @Get()
  @ApiOperation({ summary: `List a project's labels` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ProjectLabelResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewLabel);
    const labels = await this.labelRepo.find({
      where: { project: { id: membership.project.id } },
      order: { value: 'ASC' },
    });
    return {
      data: labels.map(t => ({
        id: t.id,
        value: t.value,
        color: t.color,
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a new project label' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectLabelResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.PAYMENT_REQUIRED, description: 'Plan limit reached' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Param('projectId') projectId: string, @Body() payload: AddLabelRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.AddLabel);

    const label = this.labelRepo.create({
      value: payload.value,
      color: payload.color,
      project: membership.project,
    });

    await this.labelRepo.save(label);

    return {
      data: {
        id: label.id,
        value: label.value,
        color: label.color,
      },
    };
  }

  @Patch(':labelId')
  @ApiOperation({ summary: `Update a project's label` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: ProjectLabelResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(@Req() req, @Param('projectId') projectId: string, @Param('labelId') labelId: string, @Body() payload: UpdateLabelRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditLabel);
    await this.labelRepo.findOneOrFail({ where: { id: labelId, project: { id: projectId } } });
    await this.labelRepo.update({ id: labelId }, payload);
    const label = await this.labelRepo.findOneByOrFail({ id: labelId });

    return {
      data: {
        id: label.id,
        value: label.value,
        color: label.color,
      },
    };
  }

  @Delete(':labelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: `Remove a project's label`, description: `Removes a project's label and removes it from all attached translations too` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('labelId') labelId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.DeleteLabel);
    const label = await this.labelRepo.findOneOrFail({ where: { id: labelId, project: { id: membership.project.id } } });
    await this.labelRepo.remove(label);
  }

  @Post(':labelId/terms/:termId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Label a project term' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, term or label not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async labelTerm(@Req() req, @Param('projectId') projectId: string, @Param('labelId') labelId: string, @Param('termId') termId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditLabel);

    const label = await this.labelRepo.findOneOrFail({ where: { id: labelId, project: { id: membership.project.id } } });
    const term = await this.termsRepo.findOneOrFail({ where: { id: termId, project: { id: membership.project.id } } });

    // Only the rows of this label are written, never the whole set of labels: a label that another request adds to or
    // removes from the term or one of its translations meanwhile stays as that request left it. The project is locked for
    // share first, so this waits for an import or a new locale that is adding translations of the term to commit, and
    // labels those too; one that starts later waits for this and reads the term with the label. The term is locked next,
    // so this also waits for a first save of a translation's value, or a label that adds a translation, to commit (they
    // lock the term for share, then read its labels) and labels that translation too; one that starts later waits for
    // this and copies the label. On SQLite, which takes no row locks, this waits for those on their edit lock instead.
    await withTermLabelEditLock(() =>
      readCommittedTransaction(this.termsRepo.manager, async entityManager => {
        await lockProjectForShare(entityManager, membership.project.id);
        await lockTerm(entityManager, term.id);

        try {
          // In a savepoint of its own: on Postgres a failed statement ends the transaction
          await entityManager.transaction(savepoint => savepoint.createQueryBuilder().relation(Term, 'labels').of(term.id).add(label.id));
        } catch (error) {
          // The term has the label already, or another request added it meanwhile
          if (!isUniqueViolation(error)) {
            throw error;
          }
        }

        const translations = await entityManager.find(Translation, {
          select: { termId: true, projectLocaleId: true, labels: { id: true } },
          relations: { labels: true },
          where: { termId: term.id },
        });
        await this.addLabelToTranslations(
          entityManager,
          label,
          translations.filter(translation => !translation.labels.some(l => l.id === label.id)),
        );
      }),
    );
  }

  @Delete(':labelId/terms/:termId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlabel a project term' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Label removed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, term or label not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async unlabelTerm(@Req() req, @Param('projectId') projectId: string, @Param('labelId') labelId: string, @Param('termId') termId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditLabel);

    const label = await this.labelRepo.findOneOrFail({ where: { id: labelId, project: { id: membership.project.id } } });
    const term = await this.termsRepo.findOneOrFail({ where: { id: termId, project: { id: membership.project.id } } });

    // Removes this label alone: a label that another request added meanwhile stays
    await this.termsRepo.createQueryBuilder().relation(Term, 'labels').of(term.id).remove(label.id);
  }

  @Post(':labelId/terms/:termId/translations/:localeCode')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Label a project term translation',
    description: 'Adds the translation, empty and with the labels of the term, when the term has none in this locale yet',
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, term or label not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async labelTranslation(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('labelId') labelId: string,
    @Param('termId') termId: string,
    @Param('localeCode') localeCode: string,
  ) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditLabel);

    const label = await this.labelRepo.findOneOrFail({ where: { id: labelId, project: { id: membership.project.id } } });
    const term = await this.termsRepo.findOneOrFail({ where: { id: termId, project: { id: membership.project.id } } });

    const projectLocale = await this.projectLocaleRepo.findOneOrFail({
      where: {
        project: {
          id: membership.project.id,
        },
        locale: {
          code: localeCode,
        },
      },
    });

    const where = { termId: term.id, projectLocaleId: projectLocale.id };
    let translation = await this.translationsRepo.findOne({ where, relations: ['labels'] });

    // An import adds translations to the imported locale only, so a term it added has none in the other locales yet.
    // The translation is inserted, never saved over: one that another request added meanwhile keeps its value and labels.
    // It is inserted under the edit lock of the translation, as a first save of its value adds it: the two never
    // interleave, so such a save neither fails on the row added here nor drops the label from it.
    if (!translation) {
      const added = await withEditLock(translationEditLockKey(projectLocale.id, term.id), async () => {
        if (await this.translationsRepo.findOne({ where })) {
          return false;
        }
        try {
          await readCommittedTransaction(this.translationsRepo.manager, async entityManager => {
            // The term is locked for share before its labels are read: a label added to it before is read here, and the
            // request of one added later waits for this to commit and then labels the translation added here (lockTerm)
            const share = isDbType(DbType.BETTER_SQLITE3) ? {} : { lock: { mode: 'pessimistic_read' as const } };
            if (!(await entityManager.findOne(Term, { where: { id: term.id }, ...share }))) {
              throw new NotFoundException('project term not found');
            }
            const { labels } = await entityManager.findOneOrFail(Term, { where: { id: term.id }, relations: ['labels'] });

            await entityManager.insert(Translation, { ...where, value: '' });
            // Copy term labels on creation
            const labelIds = [...labels.map(l => l.id).filter(id => id !== label.id), label.id];
            await entityManager.createQueryBuilder().relation(Translation, 'labels').of(where).add(labelIds);
          });
          return true;
        } catch (error) {
          // Another API process added it meanwhile
          if (!isUniqueViolation(error)) {
            throw error;
          }
          return false;
        }
      });
      if (added) {
        return;
      }
      translation = await this.translationsRepo.findOneOrFail({ where, relations: ['labels'] });
    }

    if (!translation.labels.some(l => l.id === label.id)) {
      // Adds this label alone: a label that another request added meanwhile stays
      try {
        await this.translationsRepo.createQueryBuilder().relation(Translation, 'labels').of(where).add(label.id);
      } catch (error) {
        // Another request added the same label meanwhile
        if (!isUniqueViolation(error)) {
          throw error;
        }
      }
    }
  }

  @Delete(':labelId/terms/:termId/translations/:localeCode')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Unlabel a project term translation' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Label removed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, term or label not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async unlabelTranslation(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('labelId') labelId: string,
    @Param('termId') termId: string,
    @Param('localeCode') localeCode: string,
  ) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditLabel);

    const label = await this.labelRepo.findOneOrFail({ where: { id: labelId, project: { id: membership.project.id } } });

    const projectLocale = await this.projectLocaleRepo.findOneOrFail({
      where: {
        project: { id: membership.project.id },
        locale: {
          code: localeCode,
        },
      },
    });

    const where = { termId: termId, projectLocaleId: projectLocale.id };
    await this.translationsRepo.findOneOrFail({ where });

    // Removes this label alone: a label that another request added meanwhile stays
    await this.translationsRepo.createQueryBuilder().relation(Translation, 'labels').of(where).remove(label.id);
  }

  /**
   * Adds the label to the translations with one statement (per 500 of them). The rows are only inserted, and one that
   * already exists, as another request added it meanwhile, is skipped.
   */
  private async addLabelToTranslations(entityManager: EntityManager, label: Label, translations: Translation[]): Promise<void> {
    // The join table belongs to Label.translations; its columns are named after each database's naming strategy
    const relation = entityManager.connection.getMetadata(Translation).findRelationWithPropertyPath('labels');
    const junction = relation.junctionEntityMetadata;
    const labelColumns = relation.isManyToManyOwner ? junction.inverseColumns : junction.ownerColumns;
    const translationColumns = relation.isManyToManyOwner ? junction.ownerColumns : junction.inverseColumns;

    const rows = translations.map(translation => {
      const row: Record<string, unknown> = {};
      labelColumns.forEach(column => (row[column.databaseName] = column.referencedColumn.getEntityValue(label)));
      translationColumns.forEach(column => (row[column.databaseName] = column.referencedColumn.getEntityValue(translation)));
      return row;
    });

    // Within every database's limit on query parameters
    for (const chunk of _.chunk(rows, 500)) {
      await entityManager.createQueryBuilder().insert().into(junction.tableName).values(chunk).orIgnore().execute();
    }
  }
}
