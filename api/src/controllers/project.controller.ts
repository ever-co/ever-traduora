import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { omit } from 'lodash';
import { Repository } from 'typeorm';
import { config } from '../config';
import { ProjectAction } from '../domain/actions';
import { CreateProjectRequest, UpdateProjectRequest, ProjectResponse, ListProjectsResponse } from '../domain/http';
import { Plan } from '../entity/plan.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { Project } from '../entity/project.entity';
import { User } from '../entity/user.entity';
import { TooManyRequestsException } from '../errors';
import AuthorizationService from '../services/authorization.service';
import { ApiOAuth2, ApiTags, ApiResponse, ApiOperation } from '@nestjs/swagger';

@Controller('api/v1/projects')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Projects')
export default class ProjectController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List projects' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListProjectsResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const memberships = await this.projectUserRepo.find({
      where: { user: { id: user.id } },
      relations: ['project'],
    });
    return {
      data: memberships.map(p => ({
        ...p.project,
        role: p.role,
      })),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new project', description: 'Creates a new project and assigns the requesting user as the admin' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Body() payload: CreateProjectRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });

    if (user.numProjectsCreated >= config.maxProjectsPerUser) {
      throw new TooManyRequestsException('Too many projects for a single user, please contact support to request a limit increase');
    }

    const result = await this.projectRepo.manager.transaction(async tx => {
      let project = this.projectRepo.create(payload);
      project = await tx.save(project);

      // Create project user as admin
      const membership = this.projectUserRepo.create({ user, project, role: ProjectRole.Admin });
      await tx.save(membership);

      // Create default project plan
      const defaultPlan = await tx.findOneOrFail(Plan, { where: { code: config.defaultProjectPlan } });
      project.plan = defaultPlan;

      await tx.save(project);
      user.numProjectsCreated += 1;
      await tx.update(User, { id: user.id }, { numProjectsCreated: user.numProjectsCreated });

      return membership;
    });

    return { data: { ...omit(result.project, ['plan']), role: result.role } };
  }

  @Get(':projectId')
  @ApiOperation({ summary: 'Get a project by id' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ProjectResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async findOne(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewProject);
    return {
      data: {
        ...omit(membership.project, 'plan'),
        role: membership.role,
      },
    };
  }

  @Patch(':projectId')
  @ApiOperation({ summary: 'Update a project' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ProjectResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(@Req() req, @Param('projectId') projectId: string, @Body() payload: UpdateProjectRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });

    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditProject);

    await this.projectRepo.update(projectId, payload);
    const project = await this.projectRepo.findOneByOrFail({ id: projectId });

    return { data: { ...project, role: membership.role } };
  }

  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.DeleteProject);

    await this.projectRepo.manager.transaction(async tx => {
      await tx.delete(Project, { id: projectId });

      user.numProjectsCreated -= 1;
      if (user.numProjectsCreated < 0) {
        user.numProjectsCreated = 0;
      }

      await tx.update(User, { id: user.id }, { numProjectsCreated: user.numProjectsCreated });
    });
  }
}
