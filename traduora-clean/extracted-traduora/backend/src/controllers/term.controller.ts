import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards, Query } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { AddTermRequest, UpdateTermRequest, ListProjectTermsResponse, ProjectTermResponse } from '../domain/http';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import AuthorizationService from '../services/authorization.service';
import { ApiOAuth2, ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Translation } from '../entity/translation.entity';
import { getLexicalOrderClause } from '../utils/database-type-helper';
import { ProjectLocale } from '../entity/project-locale.entity';

@Controller('api/v1/projects/:projectId/terms')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Terms')
export default class TermController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(Translation) private translationRepo: Repository<Translation>,
    @InjectRepository(ProjectLocale) private projectLocaleRepo: Repository<ProjectLocale>,
  ) {}

  @Get()
  @ApiOperation({ summary: `List a project's terms` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListProjectTermsResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTerm);

    // Use query builder for consistent sorting across databases
    const queryBuilder = this.termRepo
      .createQueryBuilder('term')
      .leftJoinAndSelect('term.labels', 'label')
      .where('term.project.id = :projectId', { projectId: membership.project.id });

    // Apply database-specific collation for consistent lexical ordering
    queryBuilder.orderBy(getLexicalOrderClause('term.value'), 'ASC');

    const terms = await queryBuilder.getMany();

    const data = terms.map(t => ({
      id: t.id,
      value: t.value,
      context: t.context,
      labels: t.labels,
      date: t.date,
    }));

    return {
      data,
    };
  }

  @Get('/filter-by-label')
  @ApiOperation({ summary: 'Filter terms by a single label' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListProjectTermsResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async findByLabel(@Req() req, @Param('projectId') projectId: string, @Query('labelId') labelId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTerm);

    if (!labelId) {
      return {
        data: [],
        message: 'No label provided for filtering',
      };
    }

    const queryBuilder = this.termRepo
      .createQueryBuilder('term')
      .leftJoinAndSelect('term.labels', 'label')
      .where('term.project.id = :projectId', { projectId: membership.project.id })
      .andWhere('label.id = :labelId', { labelId });

    // Apply database-specific collation for consistent lexical ordering
    queryBuilder.orderBy(getLexicalOrderClause('term.value'), 'ASC');

    const terms = await queryBuilder.getMany();

    const data = terms.map(t => ({
      id: t.id,
      value: t.value,
      context: t.context,
      labels: t.labels,
      date: t.date,
    }));

    return {
      data,
    };
  }
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a new project term' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectTermResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.PAYMENT_REQUIRED, description: 'Plan limit reached' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Param('projectId') projectId: string, @Body() payload: AddTermRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.AddTerm, 1);

    const term = this.termRepo.create({
      value: payload.value,
      context: payload.context,
      project: membership.project,
    });

    await this.termRepo.manager.transaction(async entityManager => {
      await entityManager.save(term);

      const projectLocales = await this.projectLocaleRepo.find({
        where: {
          project: {
            id: membership.project.id,
          },
        },
      });

      const translations = projectLocales.map(projectLocale =>
        this.translationRepo.create({
          projectLocale: projectLocale,
          term: term,
          value: '',
          labels: [],
        }),
      );
      await entityManager.save(translations);

      await entityManager.increment(Project, { id: membership.project.id }, 'termsCount', 1);
    });

    return {
      data: {
        id: term.id,
        value: term.value,
        context: term.context,
        labels: [],
        date: term.date,
      },
    };
  }

  @Patch(':termId')
  @ApiOperation({ summary: `Update a project's term` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: ProjectTermResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(@Req() req, @Param('projectId') projectId: string, @Param('termId') termId: string, @Body() payload: UpdateTermRequest) {
    const user = this.auth.getRequestUserOrClient(req);

    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditTerm);

    // Ensure is project term
    await this.termRepo.findOneOrFail({ where: { id: termId, project: { id: projectId } } });

    await this.termRepo.update({ id: termId }, { value: payload.value, context: payload.context });

    const term = await this.termRepo.findOneOrFail({ where: { id: termId }, relations: ['labels'] });

    return {
      data: {
        id: term.id,
        value: term.value,
        context: term.context,
        labels: term.labels,
        date: term.date,
      },
    };
  }

  @Delete(':termId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: `Remove a project's term`, description: `Removes a project's term and all related translations` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('termId') termId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.DeleteTerm);
    await this.termRepo.manager.transaction(async entityManager => {
      const term = await entityManager.findOneOrFail(Term, { where: { id: termId, project: { id: membership.project.id } } });
      await entityManager.remove(term);
      await entityManager.decrement(Project, { id: membership.project.id }, 'termsCount', 1);
    });
  }
}
