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

/** Who takes the organization's seats: members by account, and the pending invitations of everyone else by email */
interface SeatHolders {
  memberIds: Set<string>;
  memberEmails: Set<string>;
  pendingEmails: Set<string>;
}

async function seatHolders(manager: EntityManager, organizationId: string): Promise<SeatHolders> {
  const members = await manager.find(OrganizationUser, { where: { organizationId }, relations: { user: true } });
  const memberIds = new Set(members.map(member => member.userId));
  const memberEmails = new Set(members.filter(member => member.user?.email).map(member => normalizeEmail(member.user.email)));
  const organizationInvites = await manager.find(OrganizationInvite, {
    where: { organizationId, status: InviteStatus.Sent },
    select: { id: true, email: true },
  });
  const projectInvites = await manager.find(Invite, {
    where: { status: InviteStatus.Sent, project: { organizationId } },
    select: { id: true, email: true },
  });
  const pendingEmails = new Set(
    [...organizationInvites, ...projectInvites].map(invite => normalizeEmail(invite.email)).filter(email => !memberEmails.has(email)),
  );
  return { memberIds, memberEmails, pendingEmails };
}

function seatsOf(holders: SeatHolders): number {
  return holders.memberIds.size + holders.pendingEmails.size;
}

export async function countSeats(manager: EntityManager, organizationId: string): Promise<number> {
  return seatsOf(await seatHolders(manager, organizationId));
}

function projectsOf(manager: EntityManager, organizationId: string): Promise<Project[]> {
  return manager.find(Project, { where: { organizationId }, select: { id: true, localesCount: true, termsCount: true } });
}

function sumOfStrings(projects: Project[]): number {
  return projects.reduce((sum, project) => sum + (project.localesCount || 0) * (project.termsCount || 0), 0);
}

export async function countStrings(manager: EntityManager, organizationId: string): Promise<number> {
  return sumOfStrings(await projectsOf(manager, organizationId));
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
  const holders = await seatHolders(tx, organization.id);
  const email = person.email ? normalizeEmail(person.email) : null;
  if ((person.userId && holders.memberIds.has(person.userId)) || (email && holders.memberEmails.has(email))) {
    return null;
  }
  const pending = !!email && holders.pendingEmails.has(email);
  if (pending && becomes === 'invite') {
    return null;
  }
  const used = seatsOf(holders);
  return withinLimit(seats, used, pending ? 0 : 1) ? null : new PlanLimitException('seats', seats, used, plan.code);
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
  const others = (await projectsOf(tx, organization.id)).filter(project => project.id !== projectId);
  const used = sumOfStrings(others) + before;
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

/** Recomputes the cached seat counter of the organization (`seatsUsed`) */
export async function recountSeats(manager: EntityManager, organizationId: string): Promise<void> {
  await manager.update(Organization, { id: organizationId }, { seatsUsed: await countSeats(manager, organizationId) });
}

/** Recomputes the cached strings counter of the organization (`stringsUsed`) */
export async function recountStrings(manager: EntityManager, organizationId: string): Promise<void> {
  await manager.update(Organization, { id: organizationId }, { stringsUsed: await countStrings(manager, organizationId) });
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
