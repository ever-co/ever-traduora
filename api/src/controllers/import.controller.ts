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
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import * as _ from 'lodash';
import { EntityManager, Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { IntermediateTranslation, IntermediateTranslationFormat } from '../domain/formatters';
import { ImportExportFormat, ImportQuery, ImportResponse } from '../domain/http';
import { Locale } from '../entity/locale.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { TranslationHistory } from '../entity/translation-history.entity';
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

  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthGuard())
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
        let projectLocale: ProjectLocale | undefined = await entityManager.findOne(ProjectLocale, {
          where: { project: { id: membership.project.id }, locale: { code: locale.code } },
        });

        if (projectLocale && lockLocale) {
          await entityManager.findOne(ProjectLocale, { where: { id: projectLocale.id }, lock: { mode: 'pessimistic_write' } });
        }

        if (!projectLocale) {
          // Authorize if has access to project import and can add 1 locale
          await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ImportTranslation, 0, 1);

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

        // Find existing terms and determine which terms to create
        const existingTerms = await entityManager.find(Term, {
          where: { project: { id: membership.project.id } },
          relations: ['labels'],
        });

        // Resolve which terms / translations to add or update
        const termsToAdd = this.determineTermsToAdd(existingTerms, incoming.translations, membership.project);

        // Authorize if user would have enough terms left in plan for import
        await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ImportTranslation, termsToAdd.length, 1);

        const addedTerms = await entityManager.save(Term, termsToAdd);
        const allTerms = [...addedTerms, ...existingTerms];

        const translationsToAdd = this.determineTranslationsToAdd(allTerms, incoming.translations, projectLocale);

        await entityManager.increment(Project, { id: membership.project.id }, 'termsCount', termsToAdd.length);

        // Read before the values are replaced
        const historyToAdd = await this.determineHistoryToAdd(entityManager, projectLocale, translationsToAdd, user instanceof User ? user : null);

        await entityManager.save(Translation, translationsToAdd);

        // Many rows per statement, in chunks that stay within every database's limit on query parameters
        for (const chunk of _.chunk(historyToAdd, 500)) {
          await entityManager.insert(TranslationHistory, chunk);
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

  private determineTranslationsToAdd(allTerms: Term[], incomingItems: IntermediateTranslation[], projectLocale: ProjectLocale): Translation[] {
    const termsByValue = new Map<string, Term>(allTerms.map(term => [term.value, term]));

    // One translation per term; if a term is repeated in the file the last value wins
    const translationsByTermId = new Map<string, Translation>();

    // Overwrite term in translation with saved one
    for (const translation of incomingItems) {
      const term = termsByValue.get(translation.term);
      if (!term) {
        throw new Error('missing term for translation');
      }

      translationsByTermId.set(
        term.id,
        this.translationRepo.create({
          termId: term.id,
          projectLocaleId: projectLocale.id,
          value: translation.translation,
          labels: term.labels,
        }),
      );
    }

    return Array.from(translationsByTermId.values());
  }

  /**
   * The history of the translations an import changes: one entry per translation whose value differs from the stored
   * one, numbered after that translation's latest change. Two queries for the whole import, whatever its size.
   */
  private async determineHistoryToAdd(
    entityManager: EntityManager,
    projectLocale: ProjectLocale,
    translations: Translation[],
    user: User | null,
  ): Promise<Partial<TranslationHistory>[]> {
    if (translations.length === 0) {
      return [];
    }

    const stored = await entityManager.find(Translation, { select: { termId: true, value: true }, where: { projectLocaleId: projectLocale.id } });
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
