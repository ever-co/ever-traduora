import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { OrganizationRole } from '../../domain/organization-actions';
import { Label } from '../../entity/label.entity';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { ProjectLocale } from '../../entity/project-locale.entity';
import { ProjectRole, ProjectUser } from '../../entity/project-user.entity';
import { Project } from '../../entity/project.entity';
import { Term } from '../../entity/term.entity';
import { User } from '../../entity/user.entity';
import { jsonFlatExporter } from '../../formatters/jsonflat';
import { byCodeUnits } from '../../utils/database-locks';
import { localeTranslations } from '../../utils/locale-translations';
import { ZipWriter } from '../../utils/zip-writer';
import { effectiveProjectRole, projectsOfOrganizations } from './organization-scope';
import { limitsOf, organizationUsage } from './organization-usage';

/** The name and version of the archive's layout, written into `organization.json`. */
export const ORGANIZATION_EXPORT_FORMAT = 'ever-traduora-organization-export/1';

const ROLE_ORDER: Record<string, number> = { [OrganizationRole.Owner]: 0, [OrganizationRole.Admin]: 1, [OrganizationRole.Member]: 2 };

/** A path segment made of a name: lower case ASCII letters, digits and single hyphens, at most 40 characters. */
export function pathSegment(name: string, fallback: string): string {
  const segment = (name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return segment || fallback;
}

/** The folder of a project in the archive: its name and, so that two projects of one name never meet, its id. */
export function projectFolder(project: Pick<Project, 'id' | 'name'>): string {
  return `projects/${pathSegment(project.name, 'project')}-${project.id}`;
}

/** A locale's file name: its code, with anything but letters, digits, `_` and `-` replaced. */
export function localeFile(code: string): string {
  return `${(code || 'locale').replace(/[^A-Za-z0-9_-]/g, '_')}.json`;
}

/** The archive's download name: `<slug>-export-<YYYY-MM-DD>.zip` (UTC). */
export function exportFileName(organization: Pick<Organization, 'slug'>, now: Date = new Date()): string {
  return `${organization.slug}-export-${now.toISOString().slice(0, 10)}.zip`;
}

const json = (value: unknown) => JSON.stringify(value, null, 2);

const person = (user: Pick<User, 'name' | 'email'>, role: string) => ({ name: user.name, email: user.email, role });

/**
 * The organization export (DESIGN §3.9, `GET /organizations/:id/export`, owner and admin): a ZIP archive written to
 * the response as it is read, one entry at a time (`ZipWriter`), never the whole organization in memory.
 *
 * - `organization.json`: the organization, its effective plan, its usage, who exported it and when;
 * - `members.json`: its members (name, e-mail, role);
 * - per project, `projects/<name>-<id>/`: `project.json` (name, description, locales, members), `terms.json` (with their
 *   context and labels), `labels.json`, and `translations/<locale>.json`, one file per locale as the project export
 *   writes it in flat JSON (`localeTranslations`, `jsonFlatExporter`).
 *
 * The projects are those the exporting person sees: all of them for an owner or an admin where the organization's admins
 * see every project (`effectiveProjectRole`), otherwise their own projects.
 */
@Injectable()
export class OrganizationExport {
  constructor(@InjectRepository(Organization) private readonly organizations: Repository<Organization>) {}

  private get manager(): EntityManager {
    return this.organizations.manager;
  }

  /** Writes the archive of the organization of `membership` (the exporting person's, organization loaded) to `zip`. */
  async write(membership: OrganizationUser, exportedBy: Pick<User, 'id' | 'name' | 'email'>, zip: ZipWriter, now: Date = new Date()): Promise<void> {
    const organization = membership.organization;
    const { plan } = limitsOf(organization);
    const usage = await organizationUsage(this.manager, organization);
    await zip.add(
      'organization.json',
      json({
        format: ORGANIZATION_EXPORT_FORMAT,
        exportedAt: now.toISOString(),
        exportedBy: { name: exportedBy.name, email: exportedBy.email },
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          planCode: organization.planCode,
          date: organization.date,
        },
        plan: { code: plan.code, name: plan.name },
        usage,
      }),
    );

    const members = await this.manager.find(OrganizationUser, { where: { organizationId: organization.id }, relations: ['user'] });
    await zip.add(
      'members.json',
      json(
        members
          .filter(member => member.user)
          .sort((a, b) => (ROLE_ORDER[a.role] ?? 3) - (ROLE_ORDER[b.role] ?? 3) || a.user.name.localeCompare(b.user.name))
          .map(member => person(member.user, member.role)),
      ),
    );

    for (const project of await this.visibleProjects(membership, exportedBy.id)) {
      await this.writeProject(project, zip);
    }
    await zip.finish();
  }

  /** The projects of the organization the person sees, by name. */
  private async visibleProjects(membership: OrganizationUser, userId: string): Promise<Project[]> {
    const organization = membership.organization;
    let projects: Project[];
    if (effectiveProjectRole(undefined, membership.role, organization) === ProjectRole.Admin) {
      projects = await projectsOfOrganizations(this.manager, [organization.id]);
    } else {
      const own = await this.manager.find(ProjectUser, {
        where: { user: { id: userId }, project: { organizationId: organization.id } },
        relations: ['project'],
      });
      projects = own.map(projectMembership => projectMembership.project).filter(Boolean);
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name) || byCodeUnits(a.id, b.id));
  }

  private async writeProject(project: Project, zip: ZipWriter): Promise<void> {
    const folder = projectFolder(project);
    const locales = (await this.manager.find(ProjectLocale, { where: { project: { id: project.id } }, relations: ['locale'] }))
      .filter(projectLocale => projectLocale.locale)
      .sort((a, b) => byCodeUnits(a.locale.code, b.locale.code));
    const projectMembers = await this.manager.find(ProjectUser, { where: { project: { id: project.id } }, relations: ['user'] });
    await zip.add(
      `${folder}/project.json`,
      json({
        id: project.id,
        name: project.name,
        description: project.description,
        date: project.date,
        locales: locales.map(projectLocale => projectLocale.locale.code),
        members: projectMembers
          .filter(member => member.user)
          .sort((a, b) => a.user.name.localeCompare(b.user.name))
          .map(member => person(member.user, member.role)),
      }),
    );

    const terms = await this.manager.find(Term, { where: { project: { id: project.id } }, relations: ['labels'], order: { value: 'ASC' } });
    await zip.add(
      `${folder}/terms.json`,
      json(
        terms.map(term => ({
          value: term.value,
          context: term.context ?? null,
          labels: (term.labels ?? []).map(label => label.value).sort(byCodeUnits),
          date: term.date,
        })),
      ),
    );

    const labels = await this.manager.find(Label, { where: { project: { id: project.id } }, order: { value: 'ASC' } });
    await zip.add(`${folder}/labels.json`, json(labels.map(label => ({ value: label.value, color: label.color }))));

    for (const projectLocale of locales) {
      const translations = await localeTranslations(this.manager, project.id, projectLocale.id);
      const content = await jsonFlatExporter({ iso: projectLocale.locale.code, translations });
      await zip.add(`${folder}/translations/${localeFile(projectLocale.locale.code)}`, content);
    }
  }
}
