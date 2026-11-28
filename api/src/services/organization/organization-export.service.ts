import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { OrganizationRole, OrganizationStatus } from '../../domain/organization-actions';
import { Label } from '../../entity/label.entity';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { ProjectLocale } from '../../entity/project-locale.entity';
import { ProjectRole, ProjectUser } from '../../entity/project-user.entity';
import { Project } from '../../entity/project.entity';
import { Term } from '../../entity/term.entity';
import { User } from '../../entity/user.entity';
import { OrganizationException } from '../../errors';
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
  // One pass over the characters, without a regular expression, so its time is linear on any input
  const out: string[] = [];
  for (const char of (name || '').normalize('NFKD').toLowerCase()) {
    if ((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
      out.push(char);
    } else if (out.length > 0 && out[out.length - 1] !== '-' && !isCombiningMark(char)) {
      out.push('-');
    }
  }
  let segment = out.slice(0, 40);
  while (segment.length > 0 && segment[segment.length - 1] === '-') {
    segment = segment.slice(0, -1);
  }
  return segment.join('') || fallback;
}

/** A combining accent (é is e + U+0301), dropped from names */
function isCombiningMark(char: string): boolean {
  const code = char.charCodeAt(0);
  return code >= 0x300 && code <= 0x36f;
}

/** The terms read per query for `terms.json` */
export const TERMS_PAGE = 1000;

/**
 * The organizations being exported now, in this process: one export at a time per organization (a second one answers
 * 409 `export_running`). Per process: with several replicas, one export per organization per replica.
 */
const running = new Set<string>();

/** Claims the organization for an export; the answer releases it. 409 `export_running` while another one runs. */
export function claimExport(organizationId: string): () => void {
  if (running.has(organizationId)) {
    throw new OrganizationException(
      HttpStatus.CONFLICT,
      'export_running',
      'An export of this organization is running already, try again when it is done',
    );
  }
  running.add(organizationId);
  return () => running.delete(organizationId);
}

/** The organization was suspended or deleted while its export ran: the download is broken off. */
export class ExportStoppedError extends Error {
  constructor(status: string) {
    super(`the organization became ${status} during its export`);
    this.name = 'ExportStoppedError';
  }
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
 *   context and labels, read and written in pages of {@link TERMS_PAGE}), `labels.json` (with the translations each
 *   label is on), and `translations/<locale>.json`, one file per locale as the project export writes it in flat JSON
 *   (`localeTranslations`, `jsonFlatExporter`).
 *
 * The organization's status is read again before each project: suspended or deleted meanwhile, the export stops
 * ({@link ExportStoppedError}) and the caller breaks the download off.
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
      await this.assertStillOpen(organization.id);
      await this.writeProject(project, zip);
    }
    await this.assertStillOpen(organization.id);
    await zip.finish();
  }

  private async assertStillOpen(organizationId: string): Promise<void> {
    const current = await this.manager.findOne(Organization, { where: { id: organizationId }, select: ['id', 'status'] });
    if (current?.status !== OrganizationStatus.Active) {
      throw new ExportStoppedError(current?.status ?? 'deleted');
    }
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

    await zip.addStream(`${folder}/terms.json`, this.termsJson(project.id));
    await zip.add(`${folder}/labels.json`, json(await this.labelsOf(project.id, locales)));

    for (const projectLocale of locales) {
      const translations = await localeTranslations(this.manager, project.id, projectLocale.id);
      const content = await jsonFlatExporter({ iso: projectLocale.locale.code, translations });
      await zip.add(`${folder}/translations/${localeFile(projectLocale.locale.code)}`, content);
    }
  }

  /** `terms.json`, a page of terms at a time: an array of { value, context, labels, date }. */
  private async *termsJson(projectId: string): AsyncGenerator<string> {
    yield '[';
    let first = true;
    for (let skip = 0; ; skip += TERMS_PAGE) {
      const page = await this.manager.find(Term, {
        where: { project: { id: projectId } },
        relations: ['labels'],
        order: { value: 'ASC', id: 'ASC' },
        skip,
        take: TERMS_PAGE,
      });
      for (const term of page) {
        const entry = {
          value: term.value,
          context: term.context ?? null,
          labels: (term.labels ?? []).map(label => label.value).sort(byCodeUnits),
          date: term.date,
        };
        yield `${first ? '' : ','}\n  ${JSON.stringify(entry)}`;
        first = false;
      }
      if (page.length < TERMS_PAGE) {
        break;
      }
    }
    yield first ? ']' : '\n]';
  }

  /** The project's labels, each with the translations it is on (term and locale), by value. */
  private async labelsOf(projectId: string, locales: ProjectLocale[]) {
    const labels = await this.manager.find(Label, { where: { project: { id: projectId } }, relations: ['translations'], order: { value: 'ASC' } });
    const termIds = [...new Set(labels.flatMap(label => (label.translations ?? []).map(translation => translation.termId)))];
    const termValues = new Map<string, string>();
    for (let index = 0; index < termIds.length; index += 500) {
      const terms = await this.manager.find(Term, { where: { id: In(termIds.slice(index, index + 500)) }, select: ['id', 'value'] });
      terms.forEach(term => termValues.set(term.id, term.value));
    }
    const localeCodes = new Map(locales.map(projectLocale => [projectLocale.id, projectLocale.locale.code]));
    return labels.map(label => ({
      value: label.value,
      color: label.color,
      translations: (label.translations ?? [])
        .map(translation => ({ term: termValues.get(translation.termId), locale: localeCodes.get(translation.projectLocaleId) }))
        .filter(on => on.term !== undefined && on.locale !== undefined)
        .sort((a, b) => byCodeUnits(a.term, b.term) || byCodeUnits(a.locale, b.locale)),
    }));
  }
}
