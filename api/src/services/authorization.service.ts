import { ForbiddenException, HttpStatus, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AllowedEditorActions, AllowedViewerActions, ProjectAction } from '../domain/actions';
import { isOrganizationActionAllowed, OrganizationAction } from '../domain/organization-actions';
import { OrganizationUser } from '../entity/organization-user.entity';
import { Organization } from '../entity/organization.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { OrganizationException, PaymentRequiredException } from '../errors';
import { assertOrganizationOpen, effectiveProjectRole, membershipOf, projectForAccess } from './organization/organization-scope';

// The organization scope's decisions, as they were exported from here before
export { assertOrganizationOpen, effectiveProjectRole } from './organization/organization-scope';

/** A route or body id worth a lookup: a non-empty string. */
export function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

@Injectable()
export default class AuthorizationService {
  constructor(
    @InjectRepository(ProjectClient) private projectClientRepo: Repository<ProjectClient>,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
    @InjectRepository(OrganizationUser) private organizationUserRepo: Repository<OrganizationUser>,
  ) {}

  /**
   * The project access already resolved for a caller in this request (the access guard and then the handler ask for
   * it): keyed by the request's caller object, which lives as long as its request.
   */
  private readonly resolved = new WeakMap<object, Map<string, Promise<ProjectUser | ProjectClient>>>();

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
   * 1. a user is a member of the project's organization (a non-member learns nothing more, not even its status);
   * 2. that organization is `active` (`assertOrganizationOpen`);
   * 3. the user has a project role, or is an implicit project admin (`effectiveProjectRole`);
   * 4. an API key belongs to this very project; its organization is checked as in 2, without the member step.
   * A user's answer carries the effective role; it is not a stored row when the role is implicit.
   */
  mustBeProjectUserOrClient(userOrClient: User | ProjectClient, projectId: string): Promise<ProjectUser | ProjectClient> {
    if (!isId(projectId) || !userOrClient || typeof userOrClient !== 'object') {
      return this.resolveProjectAccess(userOrClient, projectId);
    }
    let byProject = this.resolved.get(userOrClient);
    if (!byProject) {
      byProject = new Map();
      this.resolved.set(userOrClient, byProject);
    }
    let access = byProject.get(projectId);
    if (!access) {
      access = this.resolveProjectAccess(userOrClient, projectId);
      byProject.set(projectId, access);
    }
    return access;
  }

  /**
   * The caller's access to a project, read now (with `manager`, inside the caller's transaction). An id that is not a
   * non-empty string is refused before any read: TypeORM drops an `undefined` from a where clause, which would match the
   * caller's first membership of any project.
   */
  private async resolveProjectAccess(
    userOrClient: User | ProjectClient,
    projectId: string,
    manager?: EntityManager,
  ): Promise<ProjectUser | ProjectClient> {
    if (!isId(projectId)) {
      throw new ForbiddenException('project not found');
    }
    const reader = manager ?? this.organizationUserRepo.manager;
    if (userOrClient instanceof User) {
      const membership = await (manager ? manager.getRepository(ProjectUser) : this.projectUserRepo).findOne({
        where: { project: { id: projectId }, user: { id: userOrClient.id } },
        relations: ['project', 'project.plan', 'project.organization'],
      });
      const project = membership?.project ?? (await projectForAccess(reader, projectId));
      if (!project?.organizationId) {
        throw new ForbiddenException('project not found');
      }
      const organizationMembership = await membershipOf(reader, project.organizationId, userOrClient.id);
      if (!organizationMembership) {
        throw new ForbiddenException('project not found');
      }
      assertOrganizationOpen(project.organization, 'project not found');
      const role = effectiveProjectRole(membership?.role, organizationMembership.role, project.organization);
      if (!role) {
        throw new ForbiddenException('project not found');
      }
      return Object.assign(new ProjectUser(), membership ?? { user: userOrClient }, { project, role });
    } else if (userOrClient instanceof ProjectClient) {
      const membership = await (manager ? manager.getRepository(ProjectClient) : this.projectClientRepo).findOne({
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

  /**
   * Whether the caller may take `action` on the project, without the plan's limits (which the handler checks with the
   * counts it adds): the check of `@Access('project:<Action>')` routes.
   */
  async assertProjectAccess(userOrClient: User | ProjectClient, projectId: string, action: ProjectAction): Promise<ProjectUser | ProjectClient> {
    const membership = await this.mustBeProjectUserOrClient(userOrClient, projectId);
    if (!this.isAuthorized(membership.role, action)) {
      throw new ForbiddenException('you are not authorized to perform this action');
    }
    return membership;
  }

  /**
   * `assertProjectAccess` read again inside the caller's transaction, past the answer kept for the request: for a
   * request that writes long after its access was checked (an import, whose upload is read after the guard), so that
   * access ended meanwhile (removed from the project or the organization, organization suspended) stops the write.
   */
  async recheckProjectAccess(manager: EntityManager, userOrClient: User | ProjectClient, projectId: string, action: ProjectAction): Promise<void> {
    const membership = await this.resolveProjectAccess(userOrClient, projectId, manager);
    if (!this.isAuthorized(membership.role, action)) {
      throw new ForbiddenException('you are not authorized to perform this action');
    }
  }

  async authorizeProjectAction(
    userOrClient: User | ProjectClient,
    projectId: string,
    action: ProjectAction,
    newTermsCount: number = 0,
    newLocalesCount: number = 0,
  ): Promise<ProjectUser | ProjectClient> {
    const membership = await this.assertProjectAccess(userOrClient, projectId, action);

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
    if (!isId(organizationId)) {
      throw new ForbiddenException('organization not found');
    }
    const membership = await membershipOf(this.organizationUserRepo.manager, organizationId, user.id, { withOrganization: true });
    if (!membership) {
      throw new ForbiddenException('organization not found');
    }
    assertOrganizationOpen(membership.organization, 'organization not found');
    if (!isOrganizationActionAllowed(membership.role, action)) {
      throw new ForbiddenException('you are not authorized to perform this action');
    }
    return membership;
  }

  /**
   * Whether the caller may bring `targetUserId` (or a person without an account, `undefined`) into the organization
   * through a project invite. Someone who is a member already: any project admin may. Anyone new: only the owner and the
   * admins (`EditMembers`), as with organization invites; otherwise 403 `organization_admin_required`. The default
   * organization keeps the rule of a self-hosted install, where everyone is a member anyway.
   */
  async authorizeAddingToOrganization(
    caller: User,
    organization: Organization,
    targetUserId: string | undefined,
    manager?: EntityManager,
  ): Promise<void> {
    assertOrganizationOpen(organization, 'project not found');
    if (organization.isDefault) {
      return;
    }
    // Given the transaction that holds the organization lock, the decision reads the memberships as they are then
    const reader = manager ?? this.organizationUserRepo.manager;
    if (targetUserId && (await membershipOf(reader, organization.id, targetUserId))) {
      return;
    }
    const membership = await membershipOf(reader, organization.id, caller.id);
    if (!isOrganizationActionAllowed(membership?.role, OrganizationAction.EditMembers)) {
      throw new OrganizationException(
        HttpStatus.FORBIDDEN,
        'organization_admin_required',
        'Only the owner and the admins of the organization can add new people to it',
      );
    }
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
