import { HttpStatus } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { EntityManager, In } from 'typeorm';
import { config } from '../../config';
import { OrganizationPlanCode, OrganizationRole, OrganizationStatus } from '../../domain/organization-actions';
import { InviteStatus } from '../../entity/invite.entity';
import { OrganizationInvite } from '../../entity/organization-invite.entity';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { OrganizationException } from '../../errors';
import { DbType, isDbType } from '../../utils/database-type-helper';
import { activeMemberships } from './organization-scope';
import { recountSeats, usesOrganizationPlan } from './organization-usage';
import { isAllowedSlug, randomSuffix, slugFromName, withSuffix } from './slug';
import { readCommittedTransaction } from '../../utils/database-locks';

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
  return readCommittedTransaction(manager, work);
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

/**
 * For a change that adds strings to a project of the organization (a term, a locale, an import): in SaaS mode, locks the
 * organization first, before the project's own lock (`lockProject`), and answers the locked row when its plan limits it
 * (`assertStringsAdded`), so parallel changes in its projects are counted one after another. `null` otherwise: a
 * single-tenant install takes no organization lock and checks the project's own plan, as before (DESIGN §3.5).
 */
export async function lockOrganizationForStrings(tx: EntityManager, organizationId: string): Promise<Organization | null> {
  if (!config.saasEnabled) {
    return null;
  }
  const organization = await lockOrganization(tx, organizationId);
  return usesOrganizationPlan(organization) ? organization : null;
}

/**
 * Options for a read that decides something under the organization lock. Inside a transaction on PostgreSQL and MySQL
 * it is a locking read, which sees the latest committed rows: MySQL's REPEATABLE READ would otherwise answer from the
 * snapshot taken at the transaction's first read, before another writer committed (SQLite has one writer at a time).
 */
export function latestRows(manager: EntityManager): { lock?: { mode: 'pessimistic_read' } } {
  return manager.queryRunner?.isTransactionActive && !isDbType(DbType.BETTER_SQLITE3) ? { lock: { mode: 'pessimistic_read' } } : {};
}

export function findDefaultOrganization(manager: EntityManager): Promise<Organization | null> {
  return manager.findOne(Organization, { where: { isDefault: true } });
}

/**
 * The default organization. The migration makes it; should it be missing, it is made here with an insert that does
 * nothing when a sign-up at the same moment made it first (ON CONFLICT DO NOTHING, INSERT IGNORE, INSERT OR IGNORE):
 * a failed insert would end the caller's transaction on PostgreSQL.
 */
export async function ensureDefaultOrganization(manager: EntityManager): Promise<Organization> {
  const existing = await findDefaultOrganization(manager);
  if (existing) {
    return existing;
  }
  await manager
    .createQueryBuilder()
    .insert()
    .into(Organization)
    .values({
      id: randomUUID(),
      name: config.defaultOrganizationName.slice(0, 255),
      slug: DEFAULT_ORGANIZATION_SLUG,
      status: OrganizationStatus.Active,
      planCode: OrganizationPlanCode.Enterprise,
      isDefault: true,
      adminsSeeAllProjects: false,
      seatsUsed: 0,
      stringsUsed: 0,
    })
    .orIgnore()
    .execute();
  // When a sign-up at the same moment made it first, the insert did nothing. Inside a transaction, MySQL's REPEATABLE
  // READ would then still show the snapshot of the first read above (no default organization), so the row is read
  // again with a locking read, which sees the latest committed version (SQLite has no row locks and one writer).
  const made = await manager.findOne(Organization, { where: { isDefault: true }, ...latestRows(manager) });
  if (!made) {
    throw new Error('the default organization could not be made');
  }
  return made;
}

/** Recomputes the cached seat counter (DESIGN §3.6), see `organization-usage.ts` */
export { recountSeats };

/**
 * Makes the user a member of the organization with `role`, unless they are one already (their role then stays).
 * Returns the membership. Needs a transaction (the organization row is locked).
 */
export async function ensureMember(
  manager: EntityManager,
  organizationId: string,
  userId: string,
  role: OrganizationRole = OrganizationRole.Member,
): Promise<OrganizationUser> {
  // The organization's lock first: two invitations of the same person wait for each other instead of colliding on the
  // unique key, seats are counted one change at a time, and an account deletion holding the lock sees every member
  await lockOrganization(manager, organizationId);
  const existing = await manager.findOne(OrganizationUser, { where: { organizationId, userId }, ...latestRows(manager) });
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
    const existing = await tx.findOne(OrganizationUser, { where: { organizationId: organization.id, userId }, ...latestRows(tx) });
    if (existing) {
      return existing;
    }
    const owner = await tx.findOne(OrganizationUser, {
      where: { organizationId: organization.id, role: OrganizationRole.Owner },
      ...latestRows(tx),
    });
    const hasOwner = !!owner;
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
  const active = await activeMemberships(manager, user.id);
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

// Part of the organization scope (see organization-scope.ts), here for the callers that imported it from this module
export { activeMemberships } from './organization-scope';

/**
 * Closes an organization that has no member left (not the default one, which the next account joins): it becomes
 * `deleted`, so nobody reaches it, and its pending invites go, so nobody joins it. Its data stays; deleting it is the
 * organization deletion of P6. Needs the organization row locked by the caller's transaction.
 */
export async function closeIfEmpty(tx: EntityManager, organizationId: string): Promise<boolean> {
  const organization = await tx.findOne(Organization, { where: { id: organizationId } });
  if (!organization || organization.isDefault || (await tx.exists(OrganizationUser, { where: { organizationId } }))) {
    return false;
  }
  await tx.delete(OrganizationInvite, { organizationId, status: InviteStatus.Sent });
  await tx.update(Organization, { id: organizationId }, { status: OrganizationStatus.Deleted });
  await recountSeats(tx, organizationId);
  return true;
}

/**
 * Whether the organization can take a new member: `active`, with its owner (the default organization may wait for its
 * first account, which becomes the owner).
 */
export async function isOpenForMembers(manager: EntityManager, organizationId: string): Promise<boolean> {
  const organization = await manager.findOne(Organization, { where: { id: organizationId } });
  if (organization?.status !== OrganizationStatus.Active) {
    return false;
  }
  return organization.isDefault || manager.exists(OrganizationUser, { where: { organizationId, role: OrganizationRole.Owner } });
}

/**
 * Why deleting these accounts would leave an organization without its owner, `null` when it would not: an account owns
 * an organization other than the default one where someone not being deleted remains. Reads only; the deletion itself
 * (`deleteAccountsWithOrganizations`) checks again under the organization locks.
 */
export async function organizationDeletionHold(manager: EntityManager, userIds: ReadonlyArray<string>): Promise<string | null> {
  const deleting = new Set(userIds);
  const owned = await manager.find(OrganizationUser, {
    where: { userId: In([...deleting]), role: OrganizationRole.Owner },
    relations: ['organization'],
  });
  for (const ownership of owned) {
    if (ownership.organization?.isDefault) {
      continue;
    }
    const members = await manager.find(OrganizationUser, { where: { organizationId: ownership.organizationId } });
    if (members.some(member => !deleting.has(member.userId))) {
      return ownership.organization?.name ?? ownership.organizationId;
    }
  }
  return null;
}

/**
 * Deletes accounts (`remove`, given the transaction) together with what their organizations need, in one transaction
 * that holds each organization's lock until the accounts are gone (memberships take the same lock, see `ensureMember`):
 * - an owner of an organization where someone not being deleted remains: the default organization (single-tenant
 *   mode, where nobody can transfer by hand) passes to its earliest admin, else its earliest member; another
 *   organization refuses with 422 `owner_required`, its owner transfers the ownership first;
 * - after the deletion each organization's seats are recounted, and one with nobody left is closed (`closeIfEmpty`;
 *   never the default one).
 * Memberships are read after the locks, so a transfer that committed meanwhile is seen.
 */
export async function deleteAccountsWithOrganizations(
  manager: EntityManager,
  userIds: ReadonlyArray<string>,
  remove: (tx: EntityManager) => Promise<void>,
): Promise<void> {
  const deleting = new Set(userIds);
  await inTransaction(manager, async tx => {
    const touched = await tx.find(OrganizationUser, { where: { userId: In([...deleting]) }, select: ['id', 'organizationId'] });
    // One order for the locks, so two deletions never wait on each other in a cycle
    const organizationIds = [...new Set(touched.map(membership => membership.organizationId))].sort((a, b) => a.localeCompare(b));
    for (const organizationId of organizationIds) {
      const organization = await lockOrganization(tx, organizationId);
      const members = await tx.find(OrganizationUser, { where: { organizationId }, order: { date: { created: 'ASC' }, id: 'ASC' } });
      const leavingOwner = members.find(member => deleting.has(member.userId) && member.role === OrganizationRole.Owner);
      const remaining = members.filter(member => !deleting.has(member.userId));
      if (!leavingOwner || remaining.length === 0) {
        continue;
      }
      if (!organization?.isDefault) {
        throw new OrganizationException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'owner_required',
          `Transfer the ownership of '${organization?.name}' before deleting your account`,
        );
      }
      const next = remaining.find(member => member.role === OrganizationRole.Admin) ?? remaining[0];
      await tx.update(OrganizationUser, { id: next.id }, { role: OrganizationRole.Owner });
      await tx.update(OrganizationUser, { id: leavingOwner.id }, { role: OrganizationRole.Admin });
    }
    await remove(tx);
    for (const organizationId of organizationIds) {
      if (!(await closeIfEmpty(tx, organizationId))) {
        await recountSeats(tx, organizationId);
      }
    }
  });
}
