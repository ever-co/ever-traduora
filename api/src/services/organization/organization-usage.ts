import { EntityManager } from 'typeorm';
import { config } from '../../config';
import { effectivePlan, EffectivePlan, withinLimit } from '../../domain/organization-plans';
import { Invite, InviteStatus } from '../../entity/invite.entity';
import { OrganizationInvite } from '../../entity/organization-invite.entity';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { Project } from '../../entity/project.entity';
import { PlanLimitException } from '../../errors';
import { normalizeEmail } from '../../domain/validators';

/**
 * The seats and strings of an organization against its plan (DESIGN §3.6).
 *
 * - **Seats**: its members, plus the people with a pending invitation who are not members yet: an organization
 *   invitation, or a project invitation to one of its projects (OD-T10). A person counts once, whatever they hold.
 * - **Strings**: the sum over its projects of locales × terms.
 *
 * Only an organization of SaaS mode other than the default one is limited this way; a single-tenant install and the
 * default organization keep the per-project plans (`Plan.maxStrings`, §3.5). The checks need the organization's row
 * lock (`lockOrganization`), held until the change commits, so that parallel requests are counted one after another.
 */

/** Whether the organization's plan limits it, rather than its projects' plans (SaaS mode, not the default organization) */
export function usesOrganizationPlan(organization: Pick<Organization, 'isDefault'> | null | undefined): boolean {
  return config.saasEnabled && !!organization && !organization.isDefault;
}

/** The limits that apply to the organization now (its effective plan) */
export function limitsOf(organization: Organization): EffectivePlan {
  return effectivePlan(organization, config.billingPastDueGraceDays);
}

const SENT = InviteStatus.Sent;

/** The e-mails of the organization's members (`:organizationId`), as a subquery */
function memberEmails(manager: EntityManager): string {
  return manager
    .createQueryBuilder()
    .subQuery()
    .select('member_user.email')
    .from(OrganizationUser, 'member')
    .innerJoin('member.user', 'member_user')
    .where('member.organizationId = :organizationId')
    .getQuery();
}

/** The e-mails of the organization's pending invitations (`:organizationId`, `:sent`), as a subquery */
function invitedEmails(manager: EntityManager): string {
  return manager
    .createQueryBuilder()
    .subQuery()
    .select('pending_invite.email')
    .from(OrganizationInvite, 'pending_invite')
    .where('pending_invite.organizationId = :organizationId')
    .andWhere('pending_invite.status = :sent')
    .getQuery();
}

/**
 * The seats, counted in the database: the members, plus the distinct e-mails of the pending invitations of people who
 * are not members, the organization's own and then those to its projects that are not among them.
 */
export async function countSeats(manager: EntityManager, organizationId: string): Promise<number> {
  const parameters = { organizationId, sent: SENT };
  const members = await manager.count(OrganizationUser, { where: { organizationId } });
  const invited = await manager
    .createQueryBuilder(OrganizationInvite, 'invite')
    .select('COUNT(DISTINCT invite.email)', 'count')
    .where('invite.organizationId = :organizationId')
    .andWhere('invite.status = :sent')
    .andWhere(`invite.email NOT IN ${memberEmails(manager)}`)
    .setParameters(parameters)
    .getRawOne();
  const invitedToProjects = await manager
    .createQueryBuilder(Invite, 'invite')
    .innerJoin('invite.project', 'invite_project')
    .select('COUNT(DISTINCT invite.email)', 'count')
    .where('invite_project.organizationId = :organizationId')
    .andWhere('invite.status = :sent')
    .andWhere(`invite.email NOT IN ${memberEmails(manager)}`)
    .andWhere(`invite.email NOT IN ${invitedEmails(manager)}`)
    .setParameters(parameters)
    .getRawOne();
  return members + Number(invited?.count ?? 0) + Number(invitedToProjects?.count ?? 0);
}

/** The strings, summed in the database over the organization's projects, but `excludingProjectId` when given */
export async function countStrings(manager: EntityManager, organizationId: string, excludingProjectId?: string): Promise<number> {
  const query = manager
    .createQueryBuilder(Project, 'project')
    .select('COALESCE(SUM(project.localesCount * project.termsCount), 0)', 'total')
    .where('project.organizationId = :organizationId', { organizationId });
  if (excludingProjectId) {
    query.andWhere('project.id != :excludingProjectId', { excludingProjectId });
  }
  return Number((await query.getRawOne())?.total ?? 0);
}

/** Whether the person is a member of the organization, by account or by e-mail */
async function isMember(manager: EntityManager, organizationId: string, userId: string | null, email: string | null): Promise<boolean> {
  if (userId && (await manager.exists(OrganizationUser, { where: { organizationId, userId } }))) {
    return true;
  }
  return !!email && manager.exists(OrganizationUser, { where: { organizationId, user: { email } } });
}

/** Whether the e-mail has a pending invitation of the organization or of one of its projects */
async function isInvited(manager: EntityManager, organizationId: string, email: string | null): Promise<boolean> {
  if (!email) {
    return false;
  }
  return (
    (await manager.exists(OrganizationInvite, { where: { organizationId, email, status: SENT } })) ||
    manager.exists(Invite, { where: { email, status: SENT, project: { organizationId } } })
  );
}

/**
 * Whether a person may take a seat, from what is known of them: none needed by a member, nor by someone with a pending
 * invitation who gets a new one; joining (`member`) needs the organization within its seats, counting their pending
 * one already; anyone new needs one free seat.
 */
export function seatAvailable(
  seats: number | null,
  used: number,
  person: { member: boolean; invited: boolean },
  becomes: 'member' | 'invite',
): boolean {
  if (person.member || (person.invited && becomes === 'invite')) {
    return true;
  }
  return withinLimit(seats, used, person.invited ? 0 : 1);
}

/**
 * Refuses, with 402 `plan_limit_reached`, a person the organization's seats cannot take:
 * - `member`: they join now (a direct add, or the acceptance of their invitation). Someone with a pending invitation
 *   holds their seat already, yet does not join an organization that is over its limit (after a downgrade, say);
 * - `invite`: they get a pending invitation, which takes a seat unless they hold one already.
 * A member already takes nothing. Needs the organization's lock; does nothing for an organization without its own plan.
 */
export async function assertSeatAvailable(
  tx: EntityManager,
  organization: Organization,
  person: { email?: string | null; userId?: string | null },
  becomes: 'member' | 'invite',
): Promise<void> {
  const refusal = await seatRefusal(tx, organization, person, becomes);
  if (refusal) {
    throw refusal;
  }
}

/** {@link assertSeatAvailable} as an answer: the refusal, or `null` when the seat is available. */
export async function seatRefusal(
  tx: EntityManager,
  organization: Organization,
  person: { email?: string | null; userId?: string | null },
  becomes: 'member' | 'invite',
): Promise<PlanLimitException | null> {
  if (!usesOrganizationPlan(organization)) {
    return null;
  }
  const { plan, seats } = limitsOf(organization);
  if (seats === null) {
    return null;
  }
  const email = person.email ? normalizeEmail(person.email) : null;
  const member = await isMember(tx, organization.id, person.userId ?? null, email);
  const invited = !member && (await isInvited(tx, organization.id, email));
  if (member || (invited && becomes === 'invite')) {
    return null;
  }
  const used = await countSeats(tx, organization.id);
  return seatAvailable(seats, used, { member, invited }, becomes) ? null : new PlanLimitException('seats', seats, used, plan.code);
}

/**
 * Refuses, with 402 `plan_limit_reached`, a change of the project's strings from `before` to `after` that takes the
 * organization past its limit. A change that adds none (an import of existing terms, a term while the project has no
 * locale) always passes: edits keep working over the limit (OD-T13). Needs the organization's lock, then the project's;
 * does nothing for an organization without its own plan.
 */
export async function assertProjectStrings(
  tx: EntityManager,
  organization: Organization,
  projectId: string,
  before: number,
  after: number,
): Promise<void> {
  if (after <= before || !usesOrganizationPlan(organization)) {
    return;
  }
  const { plan, strings } = limitsOf(organization);
  if (strings === null) {
    return;
  }
  const used = (await countStrings(tx, organization.id, projectId)) + before;
  if (!withinLimit(strings, used, after - before)) {
    throw new PlanLimitException('strings', strings, used, plan.code);
  }
}

/**
 * {@link assertProjectStrings} for terms or locales added to the project, from its counters as stored (read after the
 * project's lock, so they are the latest).
 */
export async function assertStringsAdded(
  tx: EntityManager,
  organization: Organization,
  projectId: string,
  added: { terms?: number; locales?: number },
): Promise<void> {
  if (!usesOrganizationPlan(organization)) {
    return;
  }
  const project = await tx.findOne(Project, { where: { id: projectId }, select: { id: true, localesCount: true, termsCount: true } });
  const locales = project?.localesCount || 0;
  const terms = project?.termsCount || 0;
  await assertProjectStrings(tx, organization, projectId, locales * terms, (locales + (added.locales || 0)) * (terms + (added.terms || 0)));
}

/**
 * Whether the organization has its own plan, read without a lock (`isDefault` never changes). False at once on a
 * single-tenant install, which keeps no organization counters.
 */
async function hasOwnPlan(manager: EntityManager, organizationId: string): Promise<boolean> {
  if (!config.saasEnabled) {
    return false;
  }
  return usesOrganizationPlan(await manager.findOne(Organization, { where: { id: organizationId }, select: { id: true, isDefault: true } }));
}

/**
 * Recomputes the cached seat counter of the organization (`seatsUsed`), in the database, under the caller's
 * organization lock. Only for an organization with its own plan: the default organization and a single-tenant install
 * keep none, so a sign-up there does not count every account.
 */
export async function recountSeats(manager: EntityManager, organizationId: string): Promise<void> {
  if (await hasOwnPlan(manager, organizationId)) {
    await manager.update(Organization, { id: organizationId }, { seatsUsed: await countSeats(manager, organizationId) });
  }
}

/** Recomputes the cached strings counter of the organization (`stringsUsed`), as {@link recountSeats} does */
export async function recountStrings(manager: EntityManager, organizationId: string): Promise<void> {
  if (await hasOwnPlan(manager, organizationId)) {
    await manager.update(Organization, { id: organizationId }, { stringsUsed: await countStrings(manager, organizationId) });
  }
}

export interface OrganizationUsage {
  plan: { code: string; name: string };
  seats: { used: number; included: number | null };
  strings: { used: number; limit: number | null };
}

/** The usage of `GET /organizations/:id/usage`, counted now (the cached counters may lag behind a removal). */
export async function organizationUsage(manager: EntityManager, organization: Organization): Promise<OrganizationUsage> {
  const { plan, seats, strings } = limitsOf(organization);
  return {
    plan: { code: plan.code, name: plan.name },
    seats: { used: await countSeats(manager, organization.id), included: seats },
    strings: { used: await countStrings(manager, organization.id), limit: strings },
  };
}
