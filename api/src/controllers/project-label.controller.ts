import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { AddLabelRequest, ProjectLabelResponse, UpdateLabelRequest } from '../domain/http';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Label } from '../entity/label.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import AuthorizationService from '../services/authorization.service';

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
    const term = await this.termsRepo.findOneOrFail({ where: { id: termId, project: { id: membership.project.id } }, relations: ['labels'] });

    term.labels.push(label);

    await this.termsRepo.save(term);

    const translations = await this.translationsRepo.find({ where: { termId: term.id }, relations: ['labels'] });

    translations.forEach(t => {
      t.labels.push(label);
    });

    await this.translationsRepo.save(translations);
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
    const term = await this.termsRepo.findOneOrFail({ where: { id: termId, project: { id: membership.project.id } }, relations: ['labels'] });

    term.labels = term.labels.filter(t => t.id !== label.id);

    await this.termsRepo.save(term);
  }

  @Post(':labelId/terms/:termId/translations/:localeCode')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Label a project term translation' })
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

    const translation = await this.translationsRepo.findOneOrFail({
      where: { termId: termId, projectLocale: { id: projectLocale.id } },
      relations: ['labels'],
    });

    translation.labels.push(label);

    await this.translationsRepo.save(translation);
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

    const translation = await this.translationsRepo.findOneOrFail({
      where: { termId: termId, projectLocale: { id: projectLocale.id } },
      relations: ['labels'],
    });

    translation.labels = translation.labels.filter(t => t.id !== label.id);

    await this.translationsRepo.save(translation);
  }
}
