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
} from '@nestjs/common';
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
import { activeMemberships, homeOrganizationId, lockOrganizationForStrings } from '../services/organization/organization-membership';
import { recountSeats, recountStrings } from '../services/organization/organization-usage';
import { OrganizationScopedProjects } from '../services/organization/organization-scoped-projects.service';
import { ApiOAuth2, ApiTags, ApiResponse, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { lockAccounts, readCommittedTransaction } from '../utils/database-locks';
import { Access } from '../access/access.decorator';

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
@ApiOAuth2([])
@ApiTags('Projects')
export default class ProjectController {
  constructor(
    private auth: AuthorizationService,
    private readonly projects: OrganizationScopedProjects,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
  ) {}

  @Access('user')
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
    const organizations = await activeMemberships(this.projects.manager, user.id, organizationId ? [organizationId] : undefined);
    if (organizationId && organizations.length === 0) {
      throw new ForbiddenException('organization not found');
    }
    if (organizations.length === 0) {
      return { data: [] };
    }
    const byOrganization = new Map(organizations.map(membership => [membership.organizationId, membership]));
    const memberships = await this.projectUserRepo.find({
      where: { user: { id: user.id }, project: { organizationId: In([...byOrganization.keys()]) } },
      relations: ['project'],
    });
    const projects = new Map(memberships.map(membership => [membership.project.id, { project: membership.project, role: membership.role }]));
    // An owner or admin of an organization with adminsSeeAllProjects sees every project of it (implicit project admin,
    // see effectiveProjectRole)
    const administered = organizations
      .filter(membership => membership.organization.adminsSeeAllProjects === true && isImplicitProjectAdmin(membership.role))
      .map(membership => membership.organizationId);
    if (administered.length > 0) {
      for (const project of await this.projects.ofOrganizations(administered)) {
        if (!projects.has(project.id)) {
          projects.set(project.id, { project, role: undefined });
        }
      }
    }
    return {
      data: [...projects.values()].map(({ project, role }) =>
        projectView(
          project,
          effectiveProjectRole(role, byOrganization.get(project.organizationId)?.role, byOrganization.get(project.organizationId)?.organization),
        ),
      ),
    };
  }

  @Access('user')
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
    const organizationId = requestedOrganizationId ?? (await homeOrganizationId(this.projects.manager, user));
    // Any member may create a project in their organization (DESIGN §3.2)
    await this.auth.authorizeOrganizationAction(user, organizationId, OrganizationAction.CreateProject);

    const result = await readCommittedTransaction(this.projects.manager, async tx => {
      // The global lock order: the account (its project count changes below), then the organization, which its deletion
      // holds while it deletes the projects: a project is never created into an organization being deleted
      await lockAccounts(tx, [user.id]);
      await this.projects.lockOrganizationForNewProject(tx, organizationId, user.id);
      let project = this.projects.build(fields, organizationId);
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

  @Access('project:ViewProject')
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

  @Access('project:EditProject')
  @Patch(':projectId')
  @ApiOperation({ summary: 'Update a project' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ProjectResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(@Req() req, @Param('projectId') projectId: string, @Body() payload: UpdateProjectRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });

    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditProject);

    const project = await this.projects.update(membership.project.organizationId, projectId, payload);

    return { data: projectView(project, membership.role) };
  }

  @Access('project:DeleteProject')
  @Delete(':projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a project' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const { project } = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.DeleteProject);

    await readCommittedTransaction(this.projects.manager, async tx => {
      // The global lock order: the account (its project count changes below), the project (deleted), the organization
      await lockAccounts(tx, [user.id]);
      await this.projects.delete(tx, project.organizationId, projectId);

      user.numProjectsCreated -= 1;
      if (user.numProjectsCreated < 0) {
        user.numProjectsCreated = 0;
      }

      await tx.update(User, { id: user.id }, { numProjectsCreated: user.numProjectsCreated });

      // SaaS mode: the organization's cached counters lose the project's strings and its pending invitations
      const organization = await lockOrganizationForStrings(tx, project);
      if (organization) {
        await recountStrings(tx, organization.id);
        await recountSeats(tx, organization.id);
      }
    });
  }
}
