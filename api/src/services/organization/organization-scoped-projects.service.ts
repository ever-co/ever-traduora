import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Project } from '../../entity/project.entity';
import { projectsOfOrganizations } from './organization-scope';

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
