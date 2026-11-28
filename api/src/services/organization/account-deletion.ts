import { HttpStatus } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { OrganizationRole, OrganizationStatus } from '../../domain/organization-actions';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { ProjectRole, ProjectUser } from '../../entity/project-user.entity';
import { Project } from '../../entity/project.entity';
import { OrganizationException } from '../../errors';
import { assertDeletionConfirmed, invalidTransfer } from './organization-membership';

/**
 * Deleting one's account while others depend on it (DESIGN §3.9, `DELETE /users/me`): the last admin of a project others
 * use hands the admin role to one of them, the owner of an organization with other members hands it to one of them, and
 * the owner of an organization they are alone in may delete it with the account. `GET /users/me/deletion` says what
 * stands in the way; the deletion (`UserService.deleteAccount`) applies the choices in its one transaction.
 */

export interface AccountDeletionChoices {
  /** Project → the member who becomes its admin. */
  projectAdmins?: ReadonlyArray<{ projectId: string; userId: string }>;
  /** Organization → the member who becomes its owner. */
  organizationOwners?: ReadonlyArray<{ organizationId: string; userId: string }>;
  /** Organizations deleted with the account, each confirmed with its slug. */
  deleteOrganizations?: ReadonlyArray<{ organizationId: string; slug: string }>;
}

export interface DeletionCandidate {
  userId: string;
  name: string;
  email: string;
  role: string;
}

export interface AccountDeletionPlan {
  /** Projects the person is the last admin of while others use them: one of `members` must become admin. */
  projects: Array<{ id: string; name: string; organizationId: string; members: DeletionCandidate[] }>;
  /**
   * Organizations other than the default one that the person owns: with others in it, one of `members` must become its
   * owner; alone in it (`onlyMember`), the person may delete it with the account, else it is closed with its data kept.
   */
  organizations: Array<{
    id: string;
    name: string;
    slug: string;
    status: OrganizationStatus;
    projectsCount: number;
    onlyMember: boolean;
    members: DeletionCandidate[];
  }>;
}

const byName = (a: DeletionCandidate, b: DeletionCandidate) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email);

/** What stands in the way of deleting the account of `userId`, read now (the deletion checks again under its locks). */
export async function accountDeletionPlan(manager: EntityManager, userId: string): Promise<AccountDeletionPlan> {
  const plan: AccountDeletionPlan = { projects: [], organizations: [] };

  const administered = await manager.find(ProjectUser, { where: { user: { id: userId }, role: ProjectRole.Admin }, relations: ['project'] });
  for (const membership of administered.filter(m => m.project)) {
    const everyone = await manager.find(ProjectUser, { where: { project: { id: membership.project.id } }, relations: ['user'] });
    const others = everyone.filter(other => other.user && other.user.id !== userId);
    // The rule of the deletion itself: others use the project and none of them is an admin
    if (others.length > 0 && !others.some(other => other.role === ProjectRole.Admin)) {
      plan.projects.push({
        id: membership.project.id,
        name: membership.project.name,
        organizationId: membership.project.organizationId,
        members: others.map(other => ({ userId: other.user.id, name: other.user.name, email: other.user.email, role: other.role })).sort(byName),
      });
    }
  }
  plan.projects.sort((a, b) => a.name.localeCompare(b.name));

  const owned = await manager.find(OrganizationUser, { where: { userId, role: OrganizationRole.Owner }, relations: ['organization'] });
  for (const ownership of owned) {
    const organization = ownership.organization;
    // The default organization passes to the next member by itself; a closed one has nobody left to hand it to
    if (!organization || organization.isDefault || organization.status === OrganizationStatus.Deleted) {
      continue;
    }
    const members = await manager.find(OrganizationUser, { where: { organizationId: organization.id }, relations: ['user'] });
    const others = members
      .filter(member => member.userId !== userId && member.user)
      .map(member => ({ userId: member.userId, name: member.user.name, email: member.user.email, role: member.role }))
      .sort(byName);
    plan.organizations.push({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      status: organization.status,
      projectsCount: await manager.count(Project, { where: { organizationId: organization.id } }),
      onlyMember: others.length === 0,
      members: others,
    });
  }
  plan.organizations.sort((a, b) => a.name.localeCompare(b.name));
  return plan;
}

/**
 * The organizations to delete with the account, as they are now: each one the account owns and is alone in, active,
 * not the default one, its slug typed. Read before the deletion's transaction, for billing (which may call Stripe and
 * must not run inside it); the transaction checks each again under its lock (`deleteAccountsWithOrganizations`).
 */
export async function organizationsDeletedWithAccount(
  manager: EntityManager,
  userId: string,
  choices: AccountDeletionChoices['deleteOrganizations'] = [],
): Promise<Organization[]> {
  if (choices.length === 0) {
    return [];
  }
  const ids = [...new Set(choices.map(choice => choice.organizationId))];
  const owned = await manager.find(OrganizationUser, {
    where: { userId, role: OrganizationRole.Owner, organizationId: In(ids) },
    relations: ['organization'],
  });
  const byId = new Map(owned.filter(ownership => ownership.organization).map(ownership => [ownership.organizationId, ownership.organization]));
  const organizations: Organization[] = [];
  for (const choice of choices) {
    const organization = byId.get(choice.organizationId);
    if (!organization || organization.status === OrganizationStatus.Deleted) {
      throw invalidTransfer('This organization is not yours to delete');
    }
    if (organization.status !== OrganizationStatus.Active) {
      throw new OrganizationException(HttpStatus.FORBIDDEN, 'organization_suspended', 'This organization is suspended');
    }
    assertDeletionConfirmed(organization, choice.slug);
    if ((await manager.count(OrganizationUser, { where: { organizationId: organization.id } })) > 1) {
      throw invalidTransfer(`'${organization.name}' has other members: hand it over to one of them instead`);
    }
    if (!organizations.includes(organization)) {
      organizations.push(organization);
    }
  }
  return organizations;
}

/**
 * Makes each chosen member an admin of the project, where the person deleting their account is an admin and the chosen
 * one a member. Runs in the deletion's transaction, after its project locks and before it counts the admins.
 */
export async function handOverProjects(
  manager: EntityManager,
  userId: string,
  choices: AccountDeletionChoices['projectAdmins'] = [],
): Promise<void> {
  const memberships = manager.getRepository(ProjectUser);
  for (const choice of choices) {
    const mine = await memberships.findOne({ where: { project: { id: choice.projectId }, user: { id: userId } } });
    const theirs =
      choice.userId === userId ? null : await memberships.findOne({ where: { project: { id: choice.projectId }, user: { id: choice.userId } } });
    if (mine?.role !== ProjectRole.Admin || !theirs) {
      throw invalidTransfer('Only an admin of the project hands the admin role over, to one of its members');
    }
    if (theirs.role !== ProjectRole.Admin) {
      await memberships.update({ id: theirs.id }, { role: ProjectRole.Admin });
    }
  }
}
