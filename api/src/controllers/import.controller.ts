import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
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
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { IntermediateTranslation, IntermediateTranslationFormat } from '../domain/formatters';
import { ImportExportFormat, ImportQuery, ImportResponse } from '../domain/http';
import { Locale } from '../entity/locale.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import { csvParser } from '../formatters/csv';
import { jsonFlatParser } from '../formatters/jsonflat';
import { jsonNestedParser } from '../formatters/jsonnested';
import { propertiesParser } from '../formatters/properties';
import { xliffParser } from '../formatters/xliff';
import { yamlFlatParser } from '../formatters/yaml-flat';
import { yamlNestedParser } from '../formatters/yaml-nested';
import AuthorizationService from '../services/authorization.service';
import { gettextParser } from '../formatters/gettext';
import { stringsParser } from '../formatters/strings';
import { ApiOAuth2Auth, ApiUseTags, ApiConsumes, ApiImplicitFile, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { androidXmlParser } from '../formatters/android-xml';
import { phpParser } from '../formatters/php';

@Controller('api/v1/projects/:projectId/imports')
@ApiUseTags('Imports')
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
  @ApiOAuth2Auth()
  @ApiOperation({ title: 'Import a translation file' })
  @ApiConsumes('multipart/form-data')
  @ApiImplicitFile({ name: 'file', required: true, description: 'The file to import' })
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

    const locale = await this.localeRepo.findOneOrFail({ where: { code: query.locale } });

    const contents = file.buffer.toString('utf-8') as string;

    const incoming = await this.parse(query.format, contents);

    return await this.termRepo.manager.transaction(async entityManager => {
      let projectLocale: ProjectLocale | undefined = await entityManager.findOne(ProjectLocale, {
        where: { project: { id: membership.project.id }, locale: { code: locale.code } },
      });

      if (!projectLocale) {
        // Authorize if has access to project import and can add 1 locale
        await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ImportTranslation, 0, 1);

        // Extract into service for creating project locales
        projectLocale = this.projectLocaleRepo.create({
          locale: locale,
          project: membership.project,
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

      await entityManager.save(Translation, translationsToAdd);

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
    });
  }

  private determineTermsToAdd(existing: Term[], incomingItems: IntermediateTranslation[], project: Project): Term[] {
    const existingTermsByValue: { [value: string]: Term } = existing.reduce((acc, term) => ({ ...acc, [term.value]: term }), {});

    const termsToAdd: Term[] = [];

    for (const incoming of incomingItems) {
      const existingTerm = existingTermsByValue[incoming.term];
      if (!existingTerm) {
        // If no term exists yet, create it
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
    const termsByValue: { [value: string]: Term } = allTerms.reduce((acc, term) => ({ ...acc, [term.value]: term }), {});

    const translationsToAdd: Translation[] = [];

    // Overwrite term in translation with saved one
    for (const translation of incomingItems) {
      const term = termsByValue[translation.term];
      if (!term) {
        throw new Error('missing term for translation');
      }

      translationsToAdd.push(
        this.translationRepo.create({
          termId: term.id,
          projectLocaleId: projectLocale.id,
          value: translation.translation,
          labels: term.labels,
        }),
      );
    }

    return translationsToAdd;
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
        default:
          throw new Error('Export format not implemented');
      }
    } catch (err) {
      throw new BadRequestException('Malformed import file');
    }
  }
}
