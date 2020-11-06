import {
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
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2Auth, ApiOperation, ApiResponse, ApiUseTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import * as _ from 'lodash';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import {
  AddLocaleRequest,
  ListProjectLocalesResponse,
  ListTermTranslatonsResponse,
  ProjectLocaleResponse,
  TermTranslatonResponse,
  UpdateTranslationRequest,
} from '../domain/http';
import { Locale } from '../entity/locale.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import AuthorizationService from '../services/authorization.service';
import AutomaticTranslationService from '../services/automatic_translation.service';

@Controller('api/v1/projects/:projectId/translations')
@UseGuards(AuthGuard())
@ApiOAuth2Auth()
@ApiUseTags('Translations')
export default class TranslationController {
  constructor(
    private auth: AuthorizationService,
    private automaticTranslationService: AutomaticTranslationService,
    @InjectRepository(Translation) private translationRepo: Repository<Translation>,
    @InjectRepository(ProjectLocale) private projectLocaleRepo: Repository<ProjectLocale>,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(Locale) private localeRepo: Repository<Locale>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
  ) {}

  @Get()
  @ApiOperation({ title: 'List all translation locales for a project' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListProjectLocalesResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTranslation);
    const locales = await this.projectLocaleRepo.find({
      where: {
        project: membership.project,
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
  @ApiOperation({ title: 'Add a new translation locale for a project' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectLocaleResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.PAYMENT_REQUIRED, description: 'Plan limit reached' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Param('projectId') projectId: string, @Body() payload: AddLocaleRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.AddTranslation, 0, 1);

    const locale = await this.localeRepo.findOne({ code: payload.code });

    if (!locale) {
      throw new NotFoundException('unknown locale code');
    }

    const projectLocale = this.projectLocaleRepo.create({
      locale: locale,
      project: membership.project,
    });

    await this.termRepo.manager.transaction(async entityManager => {
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

    const result = await this.projectLocaleRepo.findOneOrFail({
      locale,
      project: membership.project,
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

  @Get('autotranslate/:localeCode')
  @ApiOperation({ title: `Request automatic translation for untranslated strings` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async autotranslate(@Req() req, @Param('projectId') projectId: string, @Param('localeCode') localeCode: string) {
    const user = this.auth.getRequestUserOrClient(req);
    // @TODO: Implement new authorization "Autotranslate"
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTranslation);

    // Ensure locale is requested project locale
    const projectLocale = await this.projectLocaleRepo.findOneOrFail({
      where: {
        project: membership.project,
        locale: {
          code: localeCode,
        },
      },
    });

    const translations = await this.translationRepo.find({
      where: {
        projectLocale,
      },
      relations: ['term', 'labels'],
    });

    const result = translations.map(t => ({
      termId: t.term.id,
      original: t.term.value,
      value: t.value,
      labels: t.labels,
      date: t.date,
      projectLocaleId: t.projectLocaleId,
    }));

    const filteredResult = result.filter(t => !t.value || t.value.length === 0);

    if (filteredResult.length == 0) {
      // @TODO: If only I knew how to get this response to the client side. It
      // always seems to default to the default response.
      throw new BadRequestException('No untranslated strings to translate.');
    }

    try {
      // The translationResult holds the same object as filteredResult passed in,
      // but in the translationResult the value is populated with the translation.
      const translationResult = await this.automaticTranslationService.translate(
        filteredResult,
        'en', // @TODO: There is no source language anywhere yet?
        localeCode,
      );

      translationResult.forEach(async (translation: object) => {
        // @TODO: Here it should ideally also save a boolean "tocheck" or "machinetranslated"
        // which we can use to filter the results and allow a button to "validate"
        // otherwise there is no way to see what has been machine translated and
        // what not.
        await this.translationRepo.save(translation);
      });

      // In the response, we for now just put the amount of successfull result.
      // @TODO: I guess we can make this a prettier overview as well redirect
      // to the resultset of non validated translations.
      return { data: { count: translationResult.length } };
    } catch (error) {
      throw new BadRequestException('Something went wrong during the translation request', error);
    }
  }

  @Get(':localeCode')
  @ApiOperation({ title: `List translated terms for a locale` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListTermTranslatonsResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async findOne(@Req() req, @Param('projectId') projectId: string, @Param('localeCode') localeCode: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTranslation);

    // Ensure locale is requested project locale
    const projectLocale = await this.projectLocaleRepo.findOneOrFail({
      where: {
        project: membership.project,
        locale: {
          code: localeCode,
        },
      },
    });

    const translations = await this.translationRepo.find({
      where: {
        projectLocale,
      },
      relations: ['term', 'labels'],
    });

    const result = translations.map(t => ({ termId: t.term.id, value: t.value, labels: t.labels, date: t.date }));

    return { data: result };
  }

  @Patch(':localeCode')
  @ApiOperation({ title: `Update a term's translation` })
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

    const projectLocale = await this.projectLocaleRepo.findOneOrFail({
      where: {
        locale: {
          code: localeCode,
        },
        project: {
          id: projectId,
        },
      },
    });

    const term = await this.termRepo.findOneOrFail({ where: { project: { id: projectId }, id: payload.termId }, relations: ['labels'] });

    if (!term) {
      throw new NotFoundException('term not found');
    }

    let translation = await this.translationRepo.findOne({ where: { termId: term.id, projectLocale: projectLocale }, relations: ['labels'] });
    if (translation) {
      translation.value = payload.value;
    } else {
      translation = this.translationRepo.create({
        value: payload.value,
        projectLocale,
        term,
        labels: term.labels, // Copy term labels on creation
      });
    }

    await this.translationRepo.save(translation);

    return {
      data: {
        termId: term.id,
        value: translation.value,
        labels: translation.labels,
        date: translation.date,
      },
    };
  }

  @Delete(':localeCode')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ title: `Delete a project's locale`, description: `Deletes a project's locale and all related translations` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project or locale not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('localeCode') localeCode: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.DeleteTranslation);

    await this.projectLocaleRepo.manager.transaction(async entityManager => {
      const projectLocale = await entityManager.findOneOrFail(ProjectLocale, {
        where: {
          project: membership.project,
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
