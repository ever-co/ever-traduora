import { ForbiddenException, HttpStatus, NotFoundException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { isImplicitProjectAdmin, OrganizationRole, OrganizationStatus } from '../../domain/organization-actions';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { ProjectRole } from '../../entity/project-user.entity';
import { Project } from '../../entity/project.entity';
import { OrganizationException } from '../../errors';

/**
 * The organization scope (DESIGN §3.4, layer 2): which organizations a caller is a member of and with what role,
 * whether an organization is open, the role a member acts with in its projects, and the projects an owner or admin
 * sees. Every access decision about organizations reads these functions (`AuthorizationService`, the project list,
 * `OrganizationService`), and they are the only ones that do.
 *
 * The mutation check (`test/organization-isolation.mutation.json`) maps this module to a no-op double
 * (`test/mutation/no-organization-scope.ts`) that drops every organization boundary; the isolation suite must then fail
 * broadly. Keep this module the single place of these decisions, so that the check keeps measuring them.
 */

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

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;

/** The user's membership of the organization (with the organization loaded when asked), or null; 403 without both ids. */
export function membershipOf(
  manager: EntityManager,
  organizationId: string,
  userId: string,
  options: { withOrganization?: boolean } = {},
): Promise<OrganizationUser | null> {
  // TypeORM drops an undefined from a where clause: without both ids this would read some other membership
  if (!isNonEmptyString(organizationId) || !isNonEmptyString(userId)) {
    return Promise.reject(new ForbiddenException('organization not found'));
  }
  return manager.findOne(OrganizationUser, {
    where: { organizationId, userId },
    ...(options.withOrganization ? { relations: ['organization'] } : {}),
  });
}

/** The active organizations the user is a member of (only `organizationIds`, when given), with their role, earliest first. */
export async function activeMemberships(manager: EntityManager, userId: string, organizationIds?: string[]): Promise<OrganizationUser[]> {
  const memberships = await manager.find(OrganizationUser, {
    where: { userId, ...(organizationIds ? { organizationId: In(organizationIds) } : {}) },
    relations: ['organization'],
    order: { date: { created: 'ASC' }, id: 'ASC' },
  });
  return memberships.filter(membership => membership.organization?.status === OrganizationStatus.Active);
}

/** The project a route names, with its plan and its organization, for the access check that follows; null when none. */
export function projectForAccess(manager: EntityManager, projectId: string): Promise<Project | null> {
  return manager.findOne(Project, { where: { id: projectId }, relations: ['plan', 'organization'] });
}

/** Every project of these organizations: what their owners and admins see as implicit project admins. */
export function projectsOfOrganizations(manager: EntityManager, organizationIds: string[]): Promise<Project[]> {
  if (organizationIds.length === 0) {
    return Promise.resolve([]);
  }
  return manager.find(Project, { where: { organizationId: In(organizationIds) } });
}
