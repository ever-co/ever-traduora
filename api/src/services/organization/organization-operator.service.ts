import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository } from 'typeorm';
import { OrganizationPlanCode, OrganizationRole, OrganizationStatus } from '../../domain/organization-actions';
import { OperatorAudit, OperatorAuditAction } from '../../entity/operator-audit.entity';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { Project } from '../../entity/project.entity';
import { OrganizationException } from '../../errors';
import { readCommittedTransaction } from '../../utils/database-locks';
import { lockOrganization } from './organization-membership';
import { limitsOf, organizationUsage, OrganizationUsage } from './organization-usage';

/**
 * The operator console (DESIGN §3.9): the installation's operators see every organization, whatever they are a member
 * of, and suspend or restore one, each action written to `operator_audit` in its own transaction. The routes are
 * `@Access('operator')` (`OperatorController`); nothing here checks who calls.
 */

export interface OperatorPage {
  page: number;
  limit: number;
}

export interface OperatorOrganizationQuery extends OperatorPage {
  q?: string;
  status?: OrganizationStatus;
}

export interface OperatorPerson {
  userId: string;
  name: string;
  email: string;
}

export interface OperatorOrganizationSummary {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  planCode: OrganizationPlanCode;
  isDefault: boolean;
  owner: OperatorPerson | null;
  membersCount: number;
  projectsCount: number;
  seatsUsed: number;
  stringsUsed: number;
  date: { created: Date; modified: Date };
}

export interface OperatorAuditView {
  id: string;
  action: OperatorAuditAction;
  operator: { userId: string; email: string };
  organization: { id: string; name: string; slug: string } | null;
  reason: string;
  date: { created: Date };
}

export interface OperatorOrganizationDetail extends OperatorOrganizationSummary {
  plan: { code: string; name: string };
  usage: Pick<OrganizationUsage, 'seats' | 'strings'>;
  audit: OperatorAuditView[];
}

export interface Paged<T> {
  data: T[];
  meta: { total: number; page: number; limit: number };
}

/** The operator who acts, as the request's account had it then. */
export interface ActingOperator {
  id: string;
  email: string;
}

/** The latest audit rows shown with an organization. */
export const DETAIL_AUDIT_ROWS = 20;

/** A reason is 3 to 500 characters once trimmed. */
export const REASON_MIN = 3;
export const REASON_MAX = 500;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A search text as a LIKE pattern: lower case, its wildcards and escape character dropped, `%` around it. */
export function searchPattern(q: string): string {
  return `%${q.toLowerCase().replace(/[%_\\]/g, '')}%`;
}

/** What an action needs the organization to be in, and what it becomes. */
const TRANSITIONS: Record<OperatorAuditAction, { from: OrganizationStatus; to: OrganizationStatus }> = {
  [OperatorAuditAction.Suspend]: { from: OrganizationStatus.Active, to: OrganizationStatus.Suspended },
  [OperatorAuditAction.Restore]: { from: OrganizationStatus.Suspended, to: OrganizationStatus.Active },
};

@Injectable()
export class OperatorOrganizations {
  constructor(@InjectRepository(Organization) private readonly organizations: Repository<Organization>) {}

  private get manager(): EntityManager {
    return this.organizations.manager;
  }

  /** Every organization of the installation, newest first, filtered by a search text and a status. */
  async list(query: OperatorOrganizationQuery): Promise<Paged<OperatorOrganizationSummary>> {
    const builder = this.manager.createQueryBuilder(Organization, 'organization');
    if (query.status) {
      builder.andWhere('organization.status = :status', { status: query.status });
    }
    const q = query.q?.trim();
    if (q) {
      const owners = this.manager
        .createQueryBuilder()
        .subQuery()
        .select('owner_membership.organizationId')
        .from(OrganizationUser, 'owner_membership')
        .innerJoin('owner_membership.user', 'owner_user')
        .where('owner_membership.role = :ownerRole')
        .andWhere('LOWER(owner_user.email) LIKE :pattern')
        .getQuery();
      builder.andWhere(
        new Brackets(where => {
          where
            .where('LOWER(organization.name) LIKE :pattern')
            .orWhere('LOWER(organization.slug) LIKE :pattern')
            .orWhere(`organization.id IN ${owners}`);
          // An id only when the text is one: PostgreSQL refuses to compare a uuid with anything else
          if (UUID.test(q)) {
            where.orWhere('organization.id = :exactId', { exactId: q.toLowerCase() });
          }
        }),
      );
      builder.setParameters({ pattern: searchPattern(q), ownerRole: OrganizationRole.Owner });
    }
    const [organizations, total] = await builder
      .orderBy('organization.date.created', 'DESC')
      .addOrderBy('organization.id', 'ASC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return { data: await this.summaries(organizations), meta: { total, page: query.page, limit: query.limit } };
  }

  /** One organization with its plan, its usage counted now and its latest audit rows; `null` when there is none. */
  async detail(organizationId: string): Promise<OperatorOrganizationDetail | null> {
    const organization = await this.manager.findOne(Organization, { where: { id: organizationId } });
    if (!organization) {
      return null;
    }
    const [summary] = await this.summaries([organization]);
    const { plan } = limitsOf(organization);
    const usage = await organizationUsage(this.manager, organization);
    const audit = await this.audit({ organizationId, page: 1, limit: DETAIL_AUDIT_ROWS });
    return { ...summary, plan: { code: plan.code, name: plan.name }, usage: { seats: usage.seats, strings: usage.strings }, audit: audit.data };
  }

  /**
   * Suspends (`active` → `suspended`) or restores (`suspended` → `active`) the organization, and writes the audit row in
   * the same transaction, under the organization's lock. Its members feel it on their next request: every access check
   * reads the status as it is (DESIGN §3.4, layer 2). The default organization is never suspended: it holds every
   * account of an upgraded install.
   */
  async changeStatus(operator: ActingOperator, organizationId: string, action: OperatorAuditAction, reason: string): Promise<void> {
    const transition = TRANSITIONS[action];
    await readCommittedTransaction(this.manager, async tx => {
      const organization = await lockOrganization(tx, organizationId);
      if (!organization) {
        throw new NotFoundException('organization not found');
      }
      if (action === OperatorAuditAction.Suspend && organization.isDefault) {
        throw new OrganizationException(HttpStatus.BAD_REQUEST, 'default_organization', 'The default organization cannot be suspended');
      }
      if (organization.status !== transition.from) {
        throw new OrganizationException(
          HttpStatus.CONFLICT,
          'organization_status',
          `Only an organization that is ${transition.from} can be ${action === OperatorAuditAction.Suspend ? 'suspended' : 'restored'}`,
        );
      }
      await tx.update(Organization, { id: organizationId, status: transition.from }, { status: transition.to });
      await tx.insert(OperatorAudit, {
        operatorUserId: operator.id,
        operatorEmail: operator.email,
        action,
        organizationId,
        reason,
        date: { created: new Date() },
      });
    });
  }

  /** The audit log, newest first: of one organization, or of all. */
  async audit(query: OperatorPage & { organizationId?: string }): Promise<Paged<OperatorAuditView>> {
    const [rows, total] = await this.manager.findAndCount(OperatorAudit, {
      where: query.organizationId ? { organizationId: query.organizationId } : {},
      order: { date: { created: 'DESC' }, id: 'ASC' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    });
    const ids = [...new Set(rows.map(row => row.organizationId))];
    const organizations = ids.length ? await this.manager.find(Organization, { where: { id: In(ids) }, select: ['id', 'name', 'slug'] }) : [];
    const byId = new Map(organizations.map(organization => [organization.id, organization]));
    return {
      data: rows.map(row => {
        const organization = byId.get(row.organizationId);
        return {
          id: row.id,
          action: row.action,
          operator: { userId: row.operatorUserId, email: row.operatorEmail },
          organization: organization ? { id: organization.id, name: organization.name, slug: organization.slug } : null,
          reason: row.reason,
          date: { created: row.date.created },
        };
      }),
      meta: { total, page: query.page, limit: query.limit },
    };
  }

  /** The rows of a page, with each organization's owner and its counts of members and projects. */
  private async summaries(organizations: Organization[]): Promise<OperatorOrganizationSummary[]> {
    if (organizations.length === 0) {
      return [];
    }
    const ids = organizations.map(organization => organization.id);
    const owners = await this.manager.find(OrganizationUser, {
      where: { organizationId: In(ids), role: OrganizationRole.Owner },
      relations: ['user'],
    });
    const ownerOf = new Map(owners.map(owner => [owner.organizationId, owner]));
    const members = await this.countBy(OrganizationUser, 'membership', ids);
    const projects = await this.countBy(Project, 'project', ids);
    return organizations.map(organization => {
      const owner = ownerOf.get(organization.id);
      return {
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        status: organization.status,
        planCode: organization.planCode,
        isDefault: !!organization.isDefault,
        owner: owner?.user ? { userId: owner.user.id, name: owner.user.name, email: owner.user.email } : null,
        membersCount: members.get(organization.id) ?? 0,
        projectsCount: projects.get(organization.id) ?? 0,
        seatsUsed: organization.seatsUsed,
        stringsUsed: organization.stringsUsed,
        date: organization.date,
      };
    });
  }

  /** The rows of `entity` per organization, for these organizations. */
  private async countBy(entity: typeof OrganizationUser | typeof Project, alias: string, ids: string[]): Promise<Map<string, number>> {
    const rows: Array<{ organizationId: string; count: string | number }> = await this.manager
      .createQueryBuilder(entity, alias)
      .select(`${alias}.organizationId`, 'organizationId')
      .addSelect('COUNT(*)', 'count')
      .where(`${alias}.organizationId IN (:...ids)`, { ids })
      .groupBy(`${alias}.organizationId`)
      .getRawMany();
    return new Map(rows.map(row => [row.organizationId, Number(row.count)]));
  }
}
