import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { isOrganizationActionAllowed, OrganizationAction } from '../../domain/organization-actions';
import { Organization } from '../../entity/organization.entity';
import { Project } from '../../entity/project.entity';
import { lockOrganization } from './organization-membership';
import { assertOrganizationOpen, membershipOf, projectsOfOrganizations } from './organization-scope';

/**
 * The projects as the controllers reach them (DESIGN §3.4, layer 3): reads always name the organizations they look in,
 * writes stamp the organization, and nothing outside `services/organization/` injects the project repository (a source
 * scan in the unit suite keeps it so). A project route first resolves its project through
 * `AuthorizationService.authorizeProjectAction`; the reads and writes here then take that project's organization.
 */
@Injectable()
export class OrganizationScopedProjects {
  constructor(@InjectRepository(Project) private readonly projects: Repository<Project>) {}

  /** For transactions and the organization functions that take an entity manager. */
  get manager(): EntityManager {
    return this.projects.manager;
  }

  /** Every project of these organizations (an owner's or admin's list). */
  ofOrganizations(organizationIds: string[]): Promise<Project[]> {
    return projectsOfOrganizations(this.projects.manager, organizationIds);
  }

  /**
   * In the transaction that creates a project, after the account's lock (the global order): locks the organization, so
   * that a deletion of it (which holds the lock while it deletes the projects) never misses a project created meanwhile,
   * and checks again under the lock that it is open and that the person may still create projects there. The default
   * organization is never deleted nor suspended, so it is left out: its row is no queue for a self-hosted install's
   * project creations.
   */
  async lockOrganizationForNewProject(tx: EntityManager, organizationId: string, userId: string): Promise<void> {
    const known = await tx.findOne(Organization, { where: { id: organizationId }, select: { id: true, isDefault: true } });
    if (known?.isDefault) {
      return;
    }
    const organization = await lockOrganization(tx, organizationId);
    assertOrganizationOpen(organization, 'organization not found');
    const membership = await membershipOf(tx, organizationId, userId);
    if (!isOrganizationActionAllowed(membership?.role, OrganizationAction.CreateProject)) {
      throw new ForbiddenException('organization not found');
    }
  }

  /** A new project of the organization, not saved yet. */
  build(fields: Partial<Pick<Project, 'name' | 'description'>>, organizationId: string): Project {
    return this.projects.create({ ...fields, organizationId });
  }

  /** Changes the project's own fields, in its organization only; answers the project as it is then. */
  async update(organizationId: string, projectId: string, changes: Partial<Pick<Project, 'name' | 'description'>>): Promise<Project> {
    await this.projects.update({ id: projectId, organizationId }, changes);
    return this.projects.findOneByOrFail({ id: projectId, organizationId });
  }

  /** Deletes the project of the organization (its terms, locales, translations and memberships go with it). */
  async delete(tx: EntityManager, organizationId: string, projectId: string): Promise<void> {
    await tx.delete(Project, { id: projectId, organizationId });
  }
}
