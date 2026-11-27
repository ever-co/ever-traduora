import { ForbiddenException, HttpStatus, Injectable, InternalServerErrorException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AllowedEditorActions, AllowedViewerActions, ProjectAction } from '../domain/actions';
import {
  isImplicitProjectAdmin,
  isOrganizationActionAllowed,
  OrganizationAction,
  OrganizationRole,
  OrganizationStatus,
} from '../domain/organization-actions';
import { OrganizationUser } from '../entity/organization-user.entity';
import { Organization } from '../entity/organization.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { Project } from '../entity/project.entity';
import { User } from '../entity/user.entity';
import { OrganizationException, PaymentRequiredException } from '../errors';

/**
 * Refuses an organization that is not `active`: `deleted` answers 404, `suspended` 403 `organization_suspended`, and a
 * missing one (or any other status) 403, which clients see as not found. Fail closed: only `active` passes.
 */
export function assertOrganizationOpen(organization: Organization | null | undefined, notFound: string): void {
  if (!organization) {
    throw new ForbiddenException(notFound);
  }
  switch (organization.status) {
    case OrganizationStatus.Active:
      return;
    case OrganizationStatus.Suspended:
      throw new OrganizationException(HttpStatus.FORBIDDEN, 'organization_suspended', 'This organization is suspended');
    case OrganizationStatus.Deleted:
      throw new NotFoundException(notFound);
    default:
      throw new ForbiddenException(notFound);
  }
}

/**
 * The project role a person acts with: their own project role, or `admin` for an organization owner or admin where the
 * organization has `adminsSeeAllProjects` (implicit project admin, DESIGN §3.2, OD-T9). The default organization does
 * not: everyone of a self-hosted install shares it, and its owner keeps exactly the projects they had.
 */
export function effectiveProjectRole(
  projectRole: ProjectRole | undefined,
  organizationRole: OrganizationRole | undefined,
  organization: Pick<Organization, 'adminsSeeAllProjects'> | undefined,
): ProjectRole | undefined {
  if (organization?.adminsSeeAllProjects === true && isImplicitProjectAdmin(organizationRole)) {
    return ProjectRole.Admin;
  }
  return projectRole;
}

@Injectable()
export default class AuthorizationService {
  constructor(
    @InjectRepository(ProjectClient) private projectClientRepo: Repository<ProjectClient>,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
    @InjectRepository(OrganizationUser) private organizationUserRepo: Repository<OrganizationUser>,
  ) {}

  getRequestUserOrClient(req): User | ProjectClient;
  getRequestUserOrClient(req, options: { mustBeUser: true }): User;
  getRequestUserOrClient(req, options: { mustBeUser: boolean } = { mustBeUser: false }): User | ProjectClient {
    const user = req.user as User | ProjectClient;
    if (!user) {
      throw new InternalServerErrorException('user not set in request context');
    }
    if (options.mustBeUser && !(user instanceof User)) {
      throw new UnauthorizedException('only users are allowed to perform this action');
    }
    return user;
  }

  /**
   * The caller's access to a project, with `project.plan` and `project.organization` loaded. In order:
   * 1. the project's organization exists and is `active` (`assertOrganizationOpen`);
   * 2. a user is a member of that organization;
   * 3. the user has a project role, or is an implicit project admin (`effectiveProjectRole`);
   * 4. an API key belongs to this very project; its organization is checked as in 1, without the member step.
   * A user's answer carries the effective role; it is not a stored row when the role is implicit.
   */
  async mustBeProjectUserOrClient(userOrClient: User | ProjectClient, projectId: string): Promise<ProjectUser | ProjectClient> {
    if (userOrClient instanceof User) {
      const membership = await this.projectUserRepo.findOne({
        where: { project: { id: projectId }, user: { id: userOrClient.id } },
        relations: ['project', 'project.plan', 'project.organization'],
      });
      const project = membership?.project ?? (await this.projectRepo.findOne({ where: { id: projectId }, relations: ['plan', 'organization'] }));
      if (!project) {
        throw new ForbiddenException('project not found');
      }
      assertOrganizationOpen(project.organization, 'project not found');
      const organizationMembership = await this.organizationUserRepo.findOne({
        where: { organizationId: project.organizationId, userId: userOrClient.id },
      });
      if (!organizationMembership) {
        throw new ForbiddenException('project not found');
      }
      const role = effectiveProjectRole(membership?.role, organizationMembership.role, project.organization);
      if (!role) {
        throw new ForbiddenException('project not found');
      }
      return Object.assign(new ProjectUser(), membership ?? { user: userOrClient }, { project, role });
    } else if (userOrClient instanceof ProjectClient) {
      const membership = await this.projectClientRepo.findOne({
        where: { project: { id: projectId }, id: userOrClient.id },
        relations: ['project', 'project.plan', 'project.organization'],
      });
      if (!membership) {
        throw new ForbiddenException('project not found');
      }
      assertOrganizationOpen(membership.project.organization, 'project not found');
      return membership;
    } else {
      throw new ForbiddenException('unknown entity claims to be project client or user');
    }
  }

  async authorizeProjectAction(
    userOrClient: User | ProjectClient,
    projectId: string,
    action: ProjectAction,
    newTermsCount: number = 0,
    newLocalesCount: number = 0,
  ): Promise<ProjectUser | ProjectClient> {
    const membership = await this.mustBeProjectUserOrClient(userOrClient, projectId);
    if (!this.isAuthorized(membership.role, action)) {
      throw new ForbiddenException('you are not authorized to perform this action');
    }

    const currentLocalesCount = membership.project.localesCount;
    const currentTermsCount = membership.project.termsCount;

    const localesCount = currentLocalesCount + newLocalesCount;
    const termsCount = currentTermsCount + newTermsCount;

    switch (action) {
      case ProjectAction.AddTerm:
      case ProjectAction.AddTranslation:
      case ProjectAction.ImportTranslation:
        if (localesCount * termsCount > membership.project.plan.maxStrings) {
          throw new PaymentRequiredException('request would exceed plan limit');
        }
    }
    return membership;
  }

  /**
   * The caller's membership of an organization, with `organization` loaded, when their organization role allows
   * `action` (`domain/organization-actions.ts`). Refuses a non-member, an organization that is not `active`, and an
   * action the role does not have.
   */
  async authorizeOrganizationAction(user: User, organizationId: string, action: OrganizationAction): Promise<OrganizationUser> {
    const membership = await this.organizationUserRepo.findOne({
      where: { organizationId, userId: user.id },
      relations: ['organization'],
    });
    if (!membership) {
      throw new ForbiddenException('organization not found');
    }
    assertOrganizationOpen(membership.organization, 'organization not found');
    if (!isOrganizationActionAllowed(membership.role, action)) {
      throw new ForbiddenException('you are not authorized to perform this action');
    }
    return membership;
  }

  private isAuthorized(role: ProjectRole, action: ProjectAction): boolean {
    switch (role) {
      // Authorize admins to every action
      case ProjectRole.Admin:
        return true;
      case ProjectRole.Editor:
        return AllowedEditorActions.has(action);
      case ProjectRole.Viewer:
        return AllowedViewerActions.has(action);
      default:
        return false;
    }
  }
}
