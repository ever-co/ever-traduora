import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { config } from '../config';
import { ProjectAction } from '../domain/actions';
import { isImplicitProjectAdmin, OrganizationAction } from '../domain/organization-actions';
import { CreateProjectRequest, UpdateProjectRequest, ProjectResponse, ListProjectsResponse } from '../domain/http';
import { Plan } from '../entity/plan.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { Project } from '../entity/project.entity';
import { User } from '../entity/user.entity';
import { TooManyRequestsException } from '../errors';
import AuthorizationService, { effectiveProjectRole } from '../services/authorization.service';
import { activeMemberships, homeOrganizationId } from '../services/organization/organization-membership';
import { ApiOAuth2, ApiTags, ApiResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';

/** What the API answers for a project: its own fields (never its plan or organization objects) and the caller's role. */
export function projectView(project: Project, role: ProjectRole) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    termsCount: project.termsCount,
    localesCount: project.localesCount,
    organizationId: project.organizationId,
    date: project.date,
    role,
  };
}

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
  @ApiOperation({
    summary: 'List projects',
    description: 'The projects the caller can see, across their organizations. With organizationId, those of one organization.',
  })
  @ApiQuery({ name: 'organizationId', required: false })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListProjectsResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not a member of that organization' })
  async find(@Req() req, @Query('organizationId') organizationId?: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    if (organizationId !== undefined && (typeof organizationId !== 'string' || organizationId.length === 0 || organizationId.length > 64)) {
      throw new BadRequestException('invalid organizationId');
    }
    // Only organizations the caller is an active member of: a project of any other one is not listed, even with a
    // project membership left from before
    const organizations = await activeMemberships(this.projectRepo.manager, user.id, organizationId ? [organizationId] : undefined);
    if (organizationId && organizations.length === 0) {
      throw new ForbiddenException('organization not found');
    }
    if (organizations.length === 0) {
      return { data: [] };
    }
    const organizationRoles = new Map(organizations.map(membership => [membership.organizationId, membership.role]));
    const memberships = await this.projectUserRepo.find({
      where: { user: { id: user.id }, project: { organizationId: In([...organizationRoles.keys()]) } },
      relations: ['project'],
    });
    const projects = new Map(memberships.map(membership => [membership.project.id, { project: membership.project, role: membership.role }]));
    // In SaaS mode an organization owner or admin sees every project of the organization (implicit project admin,
    // see effectiveProjectRole)
    const administered = organizations.filter(membership => isImplicitProjectAdmin(membership.role)).map(membership => membership.organizationId);
    if (config.saasEnabled && administered.length > 0) {
      for (const project of await this.projectRepo.find({ where: { organizationId: In(administered) } })) {
        if (!projects.has(project.id)) {
          projects.set(project.id, { project, role: undefined });
        }
      }
    }
    return {
      data: [...projects.values()].map(({ project, role }) =>
        projectView(project, effectiveProjectRole(role, organizationRoles.get(project.organizationId))),
      ),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a new project',
    description:
      'Creates a new project in an organization and assigns the requesting user as the admin. Without organizationId: ' +
      `the default organization (single-tenant mode), or the caller's own organization (SaaS mode).`,
  })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectResponse })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not a member of that organization' })
  async create(@Req() req, @Body() payload: CreateProjectRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });

    if (user.numProjectsCreated >= config.maxProjectsPerUser) {
      throw new TooManyRequestsException('Too many projects for a single user, please contact support to request a limit increase');
    }

    const { organizationId: requestedOrganizationId, ...fields } = payload;
    const organizationId = requestedOrganizationId ?? (await homeOrganizationId(this.projectRepo.manager, user));
    // Any member may create a project in their organization (DESIGN §3.2)
    await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.CreateProject);

    const result = await this.projectRepo.manager.transaction(async tx => {
      let project = this.projectRepo.create({ ...fields, organizationId });
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

    return { data: projectView(result.project, result.role) };
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
      data: projectView(membership.project, membership.role),
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

    return { data: projectView(project, membership.role) };
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
