import { HttpStatus } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { config } from '../../config';
import { OrganizationPlanCode, OrganizationRole, OrganizationStatus } from '../../domain/organization-actions';
import { InviteStatus } from '../../entity/invite.entity';
import { OrganizationInvite } from '../../entity/organization-invite.entity';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { OrganizationException } from '../../errors';
import { DbType, isDbType } from '../../utils/database-type-helper';
import { isAllowedSlug, randomSuffix, slugFromName, withSuffix } from './slug';

/**
 * The organization writes that several places share (sign-up, invites, projects, Ever Connect provisioning), as
 * functions of an entity manager so that they join the caller's transaction. Nothing here checks who may do what: the
 * callers authorize first (`OrganizationService`, `AuthorizationService`).
 */

/** The slug of the default organization, made by the migration (existing data) or with a fresh install's first account. */
export const DEFAULT_ORGANIZATION_SLUG = 'default';

/** A name is 2 to 80 characters (DESIGN §4.1). */
export const ORGANIZATION_NAME_MIN = 2;
export const ORGANIZATION_NAME_MAX = 80;

/** Whether a database error is a unique or primary key violation (PostgreSQL, MySQL, SQLite). */
export function isDuplicateKey(error: unknown): boolean {
  const record = error as { code?: unknown; driverError?: { code?: unknown }; message?: unknown } | null;
  const code = record?.code || record?.driverError?.code;
  return (
    code === '23505' ||
    code === 'ER_DUP_ENTRY' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    (!!record && typeof record.message === 'string' && record.message.includes('UNIQUE constraint failed'))
  );
}

/**
 * Runs `work` in the caller's transaction when `manager` is one, otherwise in a new one. (On SQLite a transaction of the
 * data source's own manager waits for the open one, so a transaction must never start one from there.)
 */
export function inTransaction<T>(manager: EntityManager, work: (tx: EntityManager) => Promise<T>): Promise<T> {
  if (manager.queryRunner?.isTransactionActive) {
    return work(manager);
  }
  return manager.transaction(work);
}

/**
 * Reads the organization and, on PostgreSQL and MySQL, locks its row until the transaction ends, so that changes of its
 * owner or its seats run one after another. SQLite runs one write transaction at a time. Needs a transaction.
 */
export function lockOrganization(tx: EntityManager, organizationId: string): Promise<Organization | null> {
  return tx.findOne(Organization, {
    where: { id: organizationId },
    ...(isDbType(DbType.BETTER_SQLITE3) ? {} : { lock: { mode: 'pessimistic_write' as const } }),
  });
}

export function findDefaultOrganization(manager: EntityManager): Promise<Organization | null> {
  return manager.findOne(Organization, { where: { isDefault: true } });
}

/** The default organization; a fresh install has none until its first account, so it is made then. */
export async function ensureDefaultOrganization(manager: EntityManager): Promise<Organization> {
  const existing = await findDefaultOrganization(manager);
  if (existing) {
    return existing;
  }
  try {
    return await manager.save(
      manager.create(Organization, {
        name: config.defaultOrganizationName.slice(0, 255),
        slug: DEFAULT_ORGANIZATION_SLUG,
        status: OrganizationStatus.Active,
        planCode: OrganizationPlanCode.Enterprise,
        isDefault: true,
        adminsSeeAllProjects: false,
        seatsUsed: 0,
        stringsUsed: 0,
      }),
    );
  } catch (error) {
    // Made by a sign-up at the same moment
    const made = isDuplicateKey(error) ? await findDefaultOrganization(manager) : null;
    if (made) {
      return made;
    }
    throw error;
  }
}

/** Recomputes the cached seat counter (DESIGN §3.6): members plus pending organization invites. */
export async function recountSeats(manager: EntityManager, organizationId: string): Promise<void> {
  const members = await manager.count(OrganizationUser, { where: { organizationId } });
  const invites = await manager.count(OrganizationInvite, { where: { organizationId, status: InviteStatus.Sent } });
  await manager.update(Organization, { id: organizationId }, { seatsUsed: members + invites });
}

/**
 * Makes the user a member of the organization with `role`, unless they are one already (their role then stays).
 * Returns the membership.
 */
export async function ensureMember(
  manager: EntityManager,
  organizationId: string,
  userId: string,
  role: OrganizationRole = OrganizationRole.Member,
): Promise<OrganizationUser> {
  const existing = await manager.findOne(OrganizationUser, { where: { organizationId, userId } });
  if (existing) {
    return existing;
  }
  const membership = await manager.save(manager.create(OrganizationUser, { organizationId, userId, role }));
  await recountSeats(manager, organizationId);
  return membership;
}

/**
 * Single-tenant mode: puts the user into the default organization. The first member of an organization without an
 * owner (a fresh install's first account) becomes its owner, everyone else a member.
 */
export async function joinDefaultOrganization(manager: EntityManager, userId: string): Promise<OrganizationUser> {
  const organization = await ensureDefaultOrganization(manager);
  return inTransaction(manager, async tx => {
    await lockOrganization(tx, organization.id);
    const existing = await tx.findOne(OrganizationUser, { where: { organizationId: organization.id, userId } });
    if (existing) {
      return existing;
    }
    const hasOwner = await tx.exists(OrganizationUser, { where: { organizationId: organization.id, role: OrganizationRole.Owner } });
    return ensureMember(tx, organization.id, userId, hasOwner ? OrganizationRole.Member : OrganizationRole.Owner);
  });
}

/** A free slug for a new organization: derived from its name, with a random suffix when that one is taken. */
async function freeSlug(manager: EntityManager, name: string): Promise<string> {
  const base = slugFromName(name);
  if (!(await manager.exists(Organization, { where: { slug: base } }))) {
    return base;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = withSuffix(base, randomSuffix());
    if (!(await manager.exists(Organization, { where: { slug: candidate } }))) {
      return candidate;
    }
  }
  throw new Error('no free organization slug');
}

/**
 * Creates an organization with `ownerId` as its owner. Without a `slug`, one is derived from the name; a slug given is
 * checked by the caller (`isAllowedSlug`) and must be free, or the insert fails as a duplicate.
 */
export async function createOrganizationWithOwner(
  manager: EntityManager,
  options: { name: string; slug?: string; ownerId: string; planCode?: OrganizationPlanCode },
): Promise<{ organization: Organization; membership: OrganizationUser }> {
  return inTransaction(manager, async tx => {
    const slug = options.slug ?? (await freeSlug(tx, options.name));
    if (!isAllowedSlug(slug)) {
      throw new Error(`not an allowed organization slug: ${slug}`);
    }
    const organization = await tx.save(
      tx.create(Organization, {
        name: options.name,
        slug,
        status: OrganizationStatus.Active,
        planCode: options.planCode ?? OrganizationPlanCode.Starter,
        isDefault: false,
        // A company's own organization: its owner and admins can always reach its projects
        adminsSeeAllProjects: true,
        seatsUsed: 0,
        stringsUsed: 0,
      }),
    );
    const membership = await ensureMember(tx, organization.id, options.ownerId, OrganizationRole.Owner);
    return { organization, membership };
  });
}

/** "Ada Lovelace's organization", within the name limit. */
export function personalOrganizationName(personName: string | undefined): string {
  const suffix = "'s organization";
  const name = (personName || '').trim().slice(0, ORGANIZATION_NAME_MAX - suffix.length);
  return name.length > 0 ? `${name}${suffix}` : 'My organization';
}

/**
 * The organization a person's new project goes to when the request names none (the project API without
 * `organizationId`, Ever Connect provisioning):
 * - single-tenant mode: the default organization, joined if needed;
 * - SaaS mode: the active organization they own, else the earliest they administer, else their earliest membership. A
 *   person in none gets their own organization (owner, Starter), as at sign-up.
 */
export async function homeOrganizationId(manager: EntityManager, user: { id: string; name?: string }): Promise<string> {
  if (!config.saasEnabled) {
    const membership = await joinDefaultOrganization(manager, user.id);
    return membership.organizationId;
  }
  const memberships = await manager.find(OrganizationUser, {
    where: { userId: user.id },
    relations: ['organization'],
    order: { date: { created: 'ASC' }, id: 'ASC' },
  });
  const active = memberships.filter(membership => membership.organization?.status === OrganizationStatus.Active);
  const pick =
    active.find(membership => membership.role === OrganizationRole.Owner) ??
    active.find(membership => membership.role === OrganizationRole.Admin) ??
    active[0];
  if (pick) {
    return pick.organizationId;
  }
  const { organization } = await createOrganizationWithOwner(manager, { name: personalOrganizationName(user.name), ownerId: user.id });
  return organization.id;
}

/** The ids of the organizations the user is an active member of, with their role. */
export async function activeMemberships(manager: EntityManager, userId: string, organizationIds?: string[]): Promise<OrganizationUser[]> {
  const memberships = await manager.find(OrganizationUser, {
    where: { userId, ...(organizationIds ? { organizationId: In(organizationIds) } : {}) },
    relations: ['organization'],
    order: { date: { created: 'ASC' }, id: 'ASC' },
  });
  return memberships.filter(membership => membership.organization?.status === OrganizationStatus.Active);
}

/**
 * Before an account is deleted: an organization must not be left without an owner while it has other members. The
 * default organization (single-tenant mode, where nobody can transfer by hand) passes to its earliest admin, else its
 * earliest member. Another organization (SaaS mode) refuses: its owner transfers the ownership first.
 */
export async function passOwnershipBeforeAccountDeletion(manager: EntityManager, userId: string): Promise<void> {
  const owned = await manager.find(OrganizationUser, { where: { userId, role: OrganizationRole.Owner }, relations: ['organization'] });
  for (const ownership of owned) {
    await inTransaction(manager, async tx => {
      await lockOrganization(tx, ownership.organizationId);
      const members = await tx.find(OrganizationUser, {
        where: { organizationId: ownership.organizationId },
        order: { date: { created: 'ASC' }, id: 'ASC' },
      });
      const candidates = members.filter(member => member.userId !== userId);
      if (candidates.length === 0) {
        return;
      }
      if (!ownership.organization?.isDefault) {
        throw new OrganizationException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'owner_required',
          `Transfer the ownership of '${ownership.organization?.name}' before deleting your account`,
        );
      }
      const next = candidates.find(member => member.role === OrganizationRole.Admin) ?? candidates[0];
      await tx.update(OrganizationUser, { id: next.id }, { role: OrganizationRole.Owner });
      await tx.update(OrganizationUser, { id: ownership.id }, { role: OrganizationRole.Admin });
    });
  }
}
