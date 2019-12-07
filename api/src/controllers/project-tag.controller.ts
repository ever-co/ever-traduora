import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2Auth, ApiOperation, ApiResponse, ApiUseTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { AddTagRequest, ProjectTagResponse, UpdateTagRequest, ProjectLocaleDTO } from '../domain/http';
import { Project } from '../entity/project.entity';
import { Tag } from '../entity/tag.entity';
import AuthorizationService from '../services/authorization.service';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import { ProjectLocale } from '../entity/project-locale.entity';

@Controller('api/v1/projects/:projectId/tags')
@UseGuards(AuthGuard())
@ApiOAuth2Auth()
@ApiUseTags('Project Tags')
export default class ProjectTagController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Tag) private tagRepo: Repository<Tag>,
    @InjectRepository(Term) private termsRepo: Repository<Term>,
    @InjectRepository(ProjectLocale) private projectLocaleRepo: Repository<ProjectLocale>,
    @InjectRepository(Translation) private translationsRepo: Repository<Translation>,
  ) {}

  @Get()
  @ApiOperation({ title: `List a project's tags` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ProjectTagResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTags);
    const tags = await this.tagRepo.find({
      where: { project: { id: membership.project.id } },
      order: { value: 'ASC' },
    });
    return {
      data: tags.map(t => ({
        id: t.id,
        value: t.value,
        color: t.color,
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ title: 'Add a new project tag' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectTagResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.PAYMENT_REQUIRED, description: 'Plan limit reached' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Param('projectId') projectId: string, @Body() payload: AddTagRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.AddTags);

    const tag = this.tagRepo.create({
      value: payload.value,
      color: payload.color,
      project: membership.project,
    });

    await this.tagRepo.save(tag);

    return {
      data: {
        id: tag.id,
        value: tag.value,
        color: tag.color,
      },
    };
  }

  @Patch(':tagId')
  @ApiOperation({ title: `Update a project's tag` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: ProjectTagResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(@Req() req, @Param('projectId') projectId: string, @Param('tagId') tagId: string, @Body() payload: UpdateTagRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditTags);
    await this.tagRepo.findOneOrFail({ where: { id: tagId, project: { id: projectId } } });
    await this.tagRepo.update({ id: tagId }, payload);
    const tag = await this.tagRepo.findOneOrFail({ id: tagId });

    return {
      data: {
        id: tag.id,
        value: tag.value,
        color: tag.color,
      },
    };
  }

  @Delete(':tagId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ title: `Remove a project's tag`, description: `Removes a project's tag and removes it from all attached translations too` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('tagId') tagId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.DeleteTags);
    const tag = await this.tagRepo.findOneOrFail(tagId, { where: { project: membership.project } });
    await this.tagRepo.remove(tag);
  }

  @Post(':tagId/terms/:termId')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ title: 'Tag a project term' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, term or tag not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async tagTerm(@Req() req, @Param('projectId') projectId: string, @Param('tagId') tagId: string, @Param('termId') termId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditTags);

    const tag = await this.tagRepo.findOneOrFail(tagId, { where: { project: membership.project } });
    const term = await this.termsRepo.findOneOrFail(termId, { where: { project: membership.project }, relations: ['tags'] });

    term.tags.push(tag);

    await this.termsRepo.save(term);
  }

  @Delete(':tagId/terms/:termId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ title: 'Untag a project term' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Tag removed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, term or tag not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async untagTerm(@Req() req, @Param('projectId') projectId: string, @Param('tagId') tagId: string, @Param('termId') termId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditTags);

    const tag = await this.tagRepo.findOneOrFail(tagId, { where: { project: membership.project } });
    const term = await this.termsRepo.findOneOrFail(termId, { where: { project: membership.project }, relations: ['tags'] });

    term.tags = term.tags.filter(t => t.id !== tag.id);

    await this.termsRepo.save(term);
  }

  @Post(':tagId/terms/:termId/translations/:localeCode')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ title: 'Tag a project term translation' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, term or tag not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async tagTranslation(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('tagId') tagId: string,
    @Param('termId') termId: string,
    @Param('localeCode') localeCode: string,
  ) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditTags);

    const tag = await this.tagRepo.findOneOrFail(tagId, { where: { project: membership.project } });

    const projectLocale = await this.projectLocaleRepo.findOneOrFail({
      where: {
        project: membership.project,
        locale: {
          code: localeCode,
        },
      },
    });

    const translation = await this.translationsRepo.findOneOrFail({
      where: { termId: termId, projectLocale: projectLocale, project: membership.project },
      relations: ['tags'],
    });

    translation.tags.push(tag);

    await this.translationsRepo.save(translation);
  }

  @Delete(':tagId/terms/:termId/translations/:localeCode')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ title: 'Untag a project term translation' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Tag removed' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project, term or tag not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async untagTranslation(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('tagId') tagId: string,
    @Param('termId') termId: string,
    @Param('localeCode') localeCode: string,
  ) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditTags);

    const tag = await this.tagRepo.findOneOrFail(tagId, { where: { project: membership.project } });

    const projectLocale = await this.projectLocaleRepo.findOneOrFail({
      where: {
        project: membership.project,
        locale: {
          code: localeCode,
        },
      },
    });

    const translation = await this.translationsRepo.findOneOrFail({
      where: { termId: termId, projectLocale: projectLocale, project: membership.project },
      relations: ['tags'],
    });

    translation.tags = translation.tags.filter(t => t.id !== tag.id);

    await this.translationsRepo.save(translation);
  }
}
