import { EntityManager, In } from 'typeorm';
import { OrganizationRole } from '../../src/domain/organization-actions';
import { OrganizationUser } from '../../src/entity/organization-user.entity';
import { Organization } from '../../src/entity/organization.entity';
import { ProjectRole } from '../../src/entity/project-user.entity';
import { Project } from '../../src/entity/project.entity';

/**
 * The organization scope with every boundary removed, for the mutation check only
 * (`test/organization-isolation.mutation.json` maps `services/organization/organization-scope` here; production code
 * has no switch). Everyone is the owner of every organization, every organization counts as open, and every member acts
 * as a project admin. The isolation suite must fail broadly against it, which shows that its tests rest on the scope.
 */

export function assertOrganizationOpen(): void {
  // Every organization counts as open
}

export function effectiveProjectRole(projectRole: ProjectRole | undefined): ProjectRole | undefined {
  return projectRole ?? ProjectRole.Admin;
}

export async function membershipOf(manager: EntityManager, organizationId: string, userId: string): Promise<OrganizationUser | null> {
  const organization = await manager.findOne(Organization, { where: { id: organizationId } });
  return organization ? Object.assign(new OrganizationUser(), { organizationId, userId, role: OrganizationRole.Owner, organization }) : null;
}

export async function activeMemberships(manager: EntityManager, userId: string, organizationIds?: string[]): Promise<OrganizationUser[]> {
  const organizations = await manager.find(Organization, organizationIds ? { where: { id: In(organizationIds) } } : {});
  return organizations.map(organization =>
    Object.assign(new OrganizationUser(), { organizationId: organization.id, userId, role: OrganizationRole.Owner, organization }),
  );
}

export function projectForAccess(manager: EntityManager, projectId: string): Promise<Project | null> {
  return manager.findOne(Project, { where: { id: projectId }, relations: ['plan', 'organization'] });
}

export function projectsOfOrganizations(manager: EntityManager, organizationIds: string[]): Promise<Project[]> {
  return organizationIds.length === 0 ? Promise.resolve([]) : manager.find(Project, { where: { organizationId: In(organizationIds) } });
}
