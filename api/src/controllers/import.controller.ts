import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { InjectRepository } from '@nestjs/typeorm';
import * as _ from 'lodash';
import { EntityManager, Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { IntermediateTranslation, IntermediateTranslationFormat } from '../domain/formatters';
import { ImportExportFormat, ImportQuery, ImportResponse } from '../domain/http';
import { Label } from '../entity/label.entity';
import { Locale } from '../entity/locale.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { changeTime, TranslationHistory } from '../entity/translation-history.entity';
import { Translation } from '../entity/translation.entity';
import { User } from '../entity/user.entity';
import { csvParser } from '../formatters/csv';
import { jsonFlatParser } from '../formatters/jsonflat';
import { jsonNestedParser } from '../formatters/jsonnested';
import { propertiesParser } from '../formatters/properties';
import { xliffParser } from '../formatters/xliff';
import { yamlFlatParser } from '../formatters/yaml-flat';
import { yamlNestedParser } from '../formatters/yaml-nested';
import AuthorizationService from '../services/authorization.service';
import { isTransientDatabaseError, lockProject } from '../utils/database-locks';
import { DbType, isDbType } from '../utils/database-type-helper';
import { gettextParser } from '../formatters/gettext';
import { stringsParser } from '../formatters/strings';
import { ApiOAuth2, ApiConsumes, ApiResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { androidXmlParser } from '../formatters/android-xml';
import { phpParser } from '../formatters/php';
import { ApiFile } from './../decorators/api-file.decorator';
import { resXParser } from '../formatters/resx';
import { arbParser } from '../formatters/arb';
import { PaymentRequiredException } from './../errors';
import { Access } from '../access/access.decorator';

@Controller('api/v1/projects/:projectId/imports')
@ApiTags('Imports')
export class ImportController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Translation) private translationRepo: Repository<Translation>,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(ProjectLocale) private projectLocaleRepo: Repository<ProjectLocale>,
    @InjectRepository(Locale) private localeRepo: Repository<Locale>,
  ) {}

  @Access('project:ImportTranslation')
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } })) // 1024 KB max size
  @ApiOAuth2([])
  @ApiOperation({ summary: 'Import a translation file' })
  @ApiConsumes('multipart/form-data')
  @ApiFile('file')
  @ApiResponse({ status: HttpStatus.OK, description: 'File imported', type: ImportResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'No such resource found' })
  @ApiResponse({ status: HttpStatus.PAYMENT_REQUIRED, description: 'Plan limit reached' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async import(@Req() req, @Param('projectId') projectId: string, @Query() query: ImportQuery, @UploadedFile('file') file) {
    if (!file) {
      throw new BadRequestException('missing file to import');
    }

    const user = this.auth.getRequestUserOrClient(req);

    // Authorize user for import
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ImportTranslation, 0, 0);

    try {
      const locale = await this.localeRepo.findOneOrFail({ where: { code: query.locale } });

      const contents = file.buffer.toString('utf-8') as string;

      const incoming = await this.parse(query.format, contents);

      // Other databases than SQLite (which runs one transaction at a time): the locale stays locked until the import
      // commits, and edits of its translations wait for that, so the values and change numbers the import reads are
      // still the latest when it writes its history. Read committed (Postgres' default) makes MySQL read them as of the
      // lock, not as of the import's first read.
      const lockLocale = !isDbType(DbType.BETTER_SQLITE3);
      const run = async (entityManager: EntityManager) => {
        await lockProject(entityManager, membership.project.id);

        let projectLocale: ProjectLocale | undefined = await entityManager.findOne(ProjectLocale, {
          where: { project: { id: membership.project.id }, locale: { code: locale.code } },
        });

        if (projectLocale && lockLocale) {
          await entityManager.findOne(ProjectLocale, { where: { id: projectLocale.id }, lock: { mode: 'pessimistic_write' } });
        }

        if (!projectLocale) {
          // Extract into service for creating project locales
          projectLocale = this.projectLocaleRepo.create({
            locale: locale,
            project: {
              id: membership.project.id,
            },
          });
          projectLocale = await entityManager.save(ProjectLocale, projectLocale);
          await entityManager.increment(Project, { id: membership.project.id }, 'localesCount', 1);
        }

        // The locale's translations as stored, read once before the values are replaced: their values for the overwrite
        // option and the history, the ids of their labels so the import adds only the labels of their terms they lack.
        // Read before the labels of the terms: a label removed from a term and then from a translation after this read is
        // not one the import adds back
        const stored = await entityManager.find(Translation, {
          select: { termId: true, value: true, labels: { id: true } },
          relations: { labels: true },
          where: { projectLocaleId: projectLocale.id },
        });

        // Find existing terms and determine which terms to create
        const existingTerms = await entityManager.find(Term, {
          where: { project: { id: membership.project.id } },
          relations: ['labels'],
        });

        // Resolve which terms / translations to add or update
        const termsToAdd = this.determineTermsToAdd(existingTerms, incoming.translations, membership.project);

        // Check the plan limit against the counts as they stand inside this transaction (the project is locked, and the
        // locale is already counted if this import created it), so no locale is counted twice
        const project = await entityManager.findOneOrFail(Project, { where: { id: membership.project.id }, relations: ['plan'] });
        if (project.localesCount * (project.termsCount + termsToAdd.length) > project.plan.maxStrings) {
          throw new PaymentRequiredException('request would exceed plan limit');
        }

        const addedTerms = await entityManager.save(Term, termsToAdd);
        const allTerms = [...addedTerms, ...existingTerms];

        let translationsToAdd = this.determineTranslationsToAdd(allTerms, incoming.translations, projectLocale, stored);

        if (query.overwrite === false) {
          translationsToAdd = this.withoutStoredTranslations(translationsToAdd, stored);
        }

        await entityManager.increment(Project, { id: membership.project.id }, 'termsCount', termsToAdd.length);

        const historyToAdd = await this.determineHistoryToAdd(
          entityManager,
          projectLocale,
          translationsToAdd,
          stored,
          user instanceof User ? user : null,
        );

        // The values without the labels relation: TypeORM saves a relation as the whole set, so the label sets read above
        // would undo a label that a request added to or removed from one of these translations since
        await entityManager.save(
          Translation,
          translationsToAdd.map(({ labels, ...values }) => values),
        );
        await this.addMissingLabels(entityManager, translationsToAdd, stored);

        // Many rows per statement, in chunks that stay within every database's limit on query parameters, with one time
        // for the whole import: its changes are made at once
        const time = changeTime();
        for (const chunk of _.chunk(historyToAdd, 500)) {
          await entityManager.insert(
            TranslationHistory,
            chunk.map(row => ({ ...row, ...time })),
          );
        }

        return {
          data: {
            terms: {
              added: termsToAdd.length,
              skipped: incoming.translations.length - termsToAdd.length,
            },
            translations: {
              upserted: translationsToAdd.length,
            },
          },
        };
      };

      return await (lockLocale ? this.termRepo.manager.transaction('READ COMMITTED', run) : this.termRepo.manager.transaction(run));
    } catch (error) {
      if (error instanceof PaymentRequiredException) {
        throw new PaymentRequiredException('request would exceed plan limit');
      } else if (isTransientDatabaseError(error)) {
        // Answered as such (try again), not as a missing resource
        throw error;
      } else {
        throw new NotFoundException();
      }
    }
  }

  private determineTermsToAdd(existing: Term[], incomingItems: IntermediateTranslation[], project: Project): Term[] {
    // Maps (not plain objects) so keys such as "constructor" or "toString" are not mistaken for existing terms
    const knownTerms = new Set<string>(existing.map(term => term.value));

    const termsToAdd: Term[] = [];

    for (const incoming of incomingItems) {
      // Skip terms that exist already, and repeats of a term earlier in the same file
      // (a duplicate would violate the unique (project, value) index and fail the whole import)
      if (!knownTerms.has(incoming.term)) {
        knownTerms.add(incoming.term);
        const term = this.termRepo.create({
          project: project,
          value: incoming.term,
        });
        termsToAdd.push(term);
      }
    }

    return termsToAdd;
  }

  private determineTranslationsToAdd(
    allTerms: Term[],
    incomingItems: IntermediateTranslation[],
    projectLocale: ProjectLocale,
    stored: Pick<Translation, 'termId' | 'labels'>[],
  ): Translation[] {
    const termsByValue = new Map<string, Term>(allTerms.map(term => [term.value, term]));
    const storedLabels = new Map<string, Label[]>(stored.map(translation => [translation.termId, translation.labels ?? []]));

    // One translation per term; if a term is repeated in the file the last value wins
    const translationsByTermId = new Map<string, Translation>();

    // Overwrite term in translation with saved one
    for (const translation of incomingItems) {
      const term = termsByValue.get(translation.term);
      if (!term) {
        throw new Error('missing term for translation');
      }

      // The labels the translation has after the import: a new one gets the labels of its term, a stored one keeps its own
      // labels and gets those of its term (only the ones it lacks are written, see addMissingLabels)
      const ownLabels = storedLabels.get(term.id);
      const labels = ownLabels ? _.uniqBy([...ownLabels, ...(term.labels ?? [])], label => label.id) : term.labels;

      translationsByTermId.set(
        term.id,
        this.translationRepo.create({
          termId: term.id,
          projectLocaleId: projectLocale.id,
          value: translation.translation,
          labels,
        }),
      );
    }

    return Array.from(translationsByTermId.values());
  }

  /**
   * Adds to each imported translation the labels it lacked when the import read it (`stored`): the labels of its term.
   * The rows are only inserted, and one that already exists is skipped, so a label that a request added to or removed
   * from the translation while the import runs stays as that request left it.
   */
  private async addMissingLabels(
    entityManager: EntityManager,
    translations: Translation[],
    stored: Pick<Translation, 'termId' | 'labels'>[],
  ): Promise<void> {
    // By term: the locale has one translation per term
    const storedLabelIds = new Map<string, Set<string>>(
      stored.map(translation => [translation.termId, new Set((translation.labels ?? []).map(label => label.id))]),
    );

    // The join table belongs to Label.translations; its columns are named after each database's naming strategy
    const relation = entityManager.connection.getMetadata(Translation).findRelationWithPropertyPath('labels');
    const junction = relation.junctionEntityMetadata;
    const labelColumns = relation.isManyToManyOwner ? junction.inverseColumns : junction.ownerColumns;
    const translationColumns = relation.isManyToManyOwner ? junction.ownerColumns : junction.inverseColumns;

    const rows: Record<string, unknown>[] = [];
    for (const translation of translations) {
      const lacking = (translation.labels ?? []).filter(label => !storedLabelIds.get(translation.termId)?.has(label.id));
      for (const label of lacking) {
        const row: Record<string, unknown> = {};
        labelColumns.forEach(column => (row[column.databaseName] = column.referencedColumn.getEntityValue(label)));
        translationColumns.forEach(column => (row[column.databaseName] = column.referencedColumn.getEntityValue(translation)));
        rows.push(row);
      }
    }

    // Many rows per statement, in chunks that stay within every database's limit on query parameters
    for (const chunk of _.chunk(rows, 500)) {
      await entityManager.createQueryBuilder().insert().into(junction.tableName).values(chunk).orIgnore().execute();
    }
  }

  /**
   * Drops the translations of terms that already have a non-empty value in the locale, so an import that must not
   * overwrite only fills what is empty or missing.
   */
  private withoutStoredTranslations(translations: Translation[], stored: { termId: string; value: string }[]): Translation[] {
    const filled = new Set<string>(stored.filter(translation => translation.value !== '').map(translation => translation.termId));
    return translations.filter(translation => !filled.has(translation.termId));
  }

  /**
   * The history of the translations an import changes: one entry per translation whose value differs from the stored
   * one (`stored`, as read before the import), numbered after that translation's latest change. One query for the whole
   * import, whatever its size.
   */
  private async determineHistoryToAdd(
    entityManager: EntityManager,
    projectLocale: ProjectLocale,
    translations: Translation[],
    stored: { termId: string; value: string }[],
    user: User | null,
  ): Promise<Partial<TranslationHistory>[]> {
    if (translations.length === 0) {
      return [];
    }

    const previousValues = new Map<string, string>(stored.map(translation => [translation.termId, translation.value]));
    const changed = translations.filter(translation => (previousValues.get(translation.termId) ?? '') !== translation.value);
    if (changed.length === 0) {
      return [];
    }

    const latest: { termId: string; revision: number | string }[] = await entityManager
      .createQueryBuilder(TranslationHistory, 'history')
      .select('history.termId', 'termId')
      .addSelect('MAX(history.revision)', 'revision')
      .where('history.projectLocaleId = :projectLocaleId', { projectLocaleId: projectLocale.id })
      .groupBy('history.termId')
      .getRawMany();
    const latestRevisions = new Map<string, number>(latest.map(row => [row.termId, Number(row.revision)]));

    return changed.map(translation => ({
      termId: translation.termId,
      projectLocaleId: projectLocale.id,
      revision: (latestRevisions.get(translation.termId) ?? 0) + 1,
      previousValue: previousValues.get(translation.termId) ?? '',
      value: translation.value,
      user,
    }));
  }

  private async parse(format: ImportExportFormat, contents): Promise<IntermediateTranslationFormat> {
    try {
      switch (format) {
        case 'androidxml':
          return await androidXmlParser(contents);
        case 'csv':
          return await csvParser(contents);
        case 'xliff12':
          return await xliffParser({ version: '1.2' })(contents);
        case 'jsonflat':
          return await jsonFlatParser(contents);
        case 'jsonnested':
          return await jsonNestedParser(contents);
        case 'yamlflat':
          return await yamlFlatParser(contents);
        case 'yamlnested':
          return await yamlNestedParser(contents);
        case 'properties':
          return await propertiesParser(contents);
        case 'po':
          return await gettextParser(contents);
        case 'strings':
          return await stringsParser(contents);
        case 'php':
          return await phpParser(contents);
        case 'resx':
          return await resXParser(contents);
        case 'arb':
          return await arbParser(contents);
        default:
          throw new Error('Export format not implemented');
      }
    } catch (err) {
      throw new BadRequestException('Malformed import file');
    }
  }
}
