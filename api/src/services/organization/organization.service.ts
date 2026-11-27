import { BadRequestException, ConflictException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import { config } from '../../config';
import { OrganizationPlanCode, OrganizationRole, OrganizationStatus } from '../../domain/organization-actions';
import { normalizeEmail } from '../../domain/validators';
import { Invite, InviteStatus } from '../../entity/invite.entity';
import { OrganizationInvite } from '../../entity/organization-invite.entity';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { ProjectUser } from '../../entity/project-user.entity';
import { Project } from '../../entity/project.entity';
import { User } from '../../entity/user.entity';
import { OrganizationException } from '../../errors';
import { DbType, isDbType } from '../../utils/database-type-helper';
import { generateInviteToken, hashInviteToken, organizationInviteSignupUrl } from '../../utils/invite-token';
import MailService from '../mail.service';
import {
  activeMemberships,
  closeIfEmpty,
  isOpenForMembers,
  createOrganizationWithOwner,
  isDuplicateKey,
  lockOrganization,
  personalOrganizationName,
  recountSeats,
} from './organization-membership';
import { assertSeatAvailable, organizationUsage, OrganizationUsage, seatRefusal } from './organization-usage';
import { isAllowedSlug } from './slug';
import { byCodeUnits, readCommittedTransaction } from '../../utils/database-locks';

/** What the API answers for an organization the caller is a member of. */
export interface OrganizationView {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  planCode: OrganizationPlanCode;
  isDefault: boolean;
  adminsSeeAllProjects: boolean;
  role: OrganizationRole;
  date: { created: Date; modified: Date };
}

export interface MemberView {
  userId: string;
  name: string;
  email: string;
  role: OrganizationRole;
}

export interface InviteView {
  id: string;
  email: string;
  role: OrganizationRole;
  status: InviteStatus;
}

export function organizationView(organization: Organization, role: OrganizationRole): OrganizationView {
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    status: organization.status,
    planCode: organization.planCode,
    isDefault: !!organization.isDefault,
    adminsSeeAllProjects: !!organization.adminsSeeAllProjects,
    role,
    date: organization.date,
  };
}

function inviteView(invite: OrganizationInvite): InviteView {
  return { id: invite.id, email: invite.email, role: invite.role, status: invite.status };
}

/** An accepted invitation, with the role its person holds in the organization once it is accepted. */
export interface AcceptedInvite {
  invite: OrganizationInvite;
  role: OrganizationRole;
}

const ROLE_RANK: Record<string, number> = { [OrganizationRole.Owner]: 3, [OrganizationRole.Admin]: 2, [OrganizationRole.Member]: 1 };

/** Whether `role` is higher than `than` (owner > admin > member). */
export function outranks(role: OrganizationRole, than: OrganizationRole): boolean {
  return (ROLE_RANK[role] ?? 0) > (ROLE_RANK[than] ?? 0);
}

/** Refuses the organization routes that only SaaS mode has (a single-tenant install shows no organization at all). */
export function assertSaasEnabled(): void {
  if (!config.saasEnabled) {
    throw new OrganizationException(HttpStatus.NOT_FOUND, 'saas_disabled', 'Organizations are not enabled on this installation');
  }
}

/**
 * Organizations, their members and their invites. The routes authorize first (`AuthorizationService
 * .authorizeOrganizationAction`); the rules about the owner (exactly one, never removed, changed only by a transfer)
 * are kept here, each change in one transaction that locks the organization row first.
 */
@Injectable()
export class OrganizationService {
  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationUser) private readonly members: Repository<OrganizationUser>,
    @InjectRepository(OrganizationInvite) private readonly invites: Repository<OrganizationInvite>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly mail: MailService,
  ) {}

  /** The active organizations the user is a member of, with their role, earliest first. */
  async listForUser(userId: string): Promise<OrganizationView[]> {
    const memberships = await activeMemberships(this.members.manager, userId);
    return memberships.map(membership => organizationView(membership.organization, membership.role));
  }

  /** A new organization with the user as its owner, on the Starter plan (SaaS mode). */
  async create(user: User, payload: { name: string; slug?: string }): Promise<OrganizationView> {
    const name = payload.name.trim();
    const slug = payload.slug?.trim().toLowerCase();
    if (slug !== undefined && !isAllowedSlug(slug)) {
      throw new OrganizationException(HttpStatus.BAD_REQUEST, 'slug_invalid', 'This address is not allowed, please choose another one');
    }
    try {
      const { organization, membership } = await createOrganizationWithOwner(this.organizations.manager, { name, slug, ownerId: user.id });
      return organizationView(organization, membership.role);
    } catch (error) {
      if (isDuplicateKey(error)) {
        throw new OrganizationException(HttpStatus.CONFLICT, 'slug_taken', 'This address is taken, please choose another one');
      }
      throw error;
    }
  }

  /**
   * A new person's organization in SaaS mode: their own (owner, Starter), unless accepting invitations made them a
   * member of one already. Single-tenant mode puts every account into the default organization when it is created
   * (`UserService.create`), so nothing is left to do there.
   */
  async setUpNewAccount(user: User, organizationName?: string): Promise<void> {
    if (!config.saasEnabled) {
      return;
    }
    if ((await activeMemberships(this.members.manager, user.id)).length > 0) {
      return;
    }
    const name = organizationName?.trim() || personalOrganizationName(user.name);
    await createOrganizationWithOwner(this.organizations.manager, { name, ownerId: user.id });
  }

  async rename(organization: Organization, payload: { name?: string; slug?: string }, role: OrganizationRole): Promise<OrganizationView> {
    const changes: Partial<Organization> = {};
    if (payload.name !== undefined) {
      changes.name = payload.name.trim();
    }
    if (payload.slug !== undefined) {
      const slug = payload.slug.trim().toLowerCase();
      if (slug !== organization.slug) {
        if (!isAllowedSlug(slug)) {
          throw new OrganizationException(HttpStatus.BAD_REQUEST, 'slug_invalid', 'This address is not allowed, please choose another one');
        }
        changes.slug = slug;
      }
    }
    if (Object.keys(changes).length > 0) {
      try {
        await this.organizations.update({ id: organization.id }, changes);
      } catch (error) {
        if (isDuplicateKey(error)) {
          throw new OrganizationException(HttpStatus.CONFLICT, 'slug_taken', 'This address is taken, please choose another one');
        }
        throw error;
      }
    }
    const updated = await this.organizations.findOneByOrFail({ id: organization.id });
    return organizationView(updated, role);
  }

  async listMembers(organizationId: string): Promise<MemberView[]> {
    const memberships = await this.members.find({
      where: { organizationId },
      relations: ['user'],
      order: { date: { created: 'ASC' }, id: 'ASC' },
    });
    // The owner first, then the admins, then the members, each by name
    const rank = { [OrganizationRole.Owner]: 0, [OrganizationRole.Admin]: 1, [OrganizationRole.Member]: 2 };
    return memberships
      .map(membership => ({
        userId: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
        role: membership.role,
      }))
      .sort((a, b) => (rank[a.role] ?? 3) - (rank[b.role] ?? 3) || a.name.localeCompare(b.name));
  }

  /** Changes a member's role to `admin` or `member`. The owner's role changes only by a transfer of ownership. */
  async changeRole(organizationId: string, actingUserId: string, targetUserId: string, role: OrganizationRole): Promise<MemberView> {
    if (role !== OrganizationRole.Admin && role !== OrganizationRole.Member) {
      throw new BadRequestException('role must be admin or member');
    }
    if (actingUserId === targetUserId) {
      throw new BadRequestException(`can't edit your own role`);
    }
    await readCommittedTransaction(this.members.manager, async tx => {
      await lockOrganization(tx, organizationId);
      const target = await tx.findOne(OrganizationUser, { where: { organizationId, userId: targetUserId } });
      if (!target) {
        throw new NotFoundException('member not found');
      }
      if (target.role === OrganizationRole.Owner) {
        throw new OrganizationException(HttpStatus.BAD_REQUEST, 'owner_role', `The owner's role changes only by transferring the ownership`);
      }
      await tx.update(OrganizationUser, { id: target.id }, { role });
    });
    return this.memberView(organizationId, targetUserId);
  }

  /**
   * Removes a member (or lets a member leave, `actingUserId === targetUserId`), together with their project memberships
   * in the organization's projects: they keep no access there. The owner is never removed; they transfer first.
   */
  async removeMember(organizationId: string, actingUserId: string, targetUserId: string): Promise<void> {
    await readCommittedTransaction(this.members.manager, async tx => {
      await lockOrganization(tx, organizationId);
      const target = await tx.findOne(OrganizationUser, { where: { organizationId, userId: targetUserId } });
      if (!target) {
        throw new NotFoundException('member not found');
      }
      if (target.role === OrganizationRole.Owner) {
        throw new OrganizationException(
          HttpStatus.BAD_REQUEST,
          'owner_required',
          actingUserId === targetUserId ? 'Transfer the ownership before leaving the organization' : 'The owner cannot be removed',
        );
      }
      await this.removeMembership(tx, target);
    });
  }

  /** Deletes the membership and the person's project memberships in the organization's projects, then recounts. */
  private async removeMembership(tx: EntityManager, membership: OrganizationUser): Promise<void> {
    const projectIds = (await tx.find(Project, { where: { organizationId: membership.organizationId }, select: ['id'] })).map(project => project.id);
    // Their pending project invitations there go too: accepting one would bring them back into the organization
    const person = await tx.findOne(User, { where: { id: membership.userId }, select: ['id', 'email'] });
    for (let index = 0; index < projectIds.length; index += 500) {
      const page = projectIds.slice(index, index + 500);
      await tx.delete(ProjectUser, { user: { id: membership.userId }, project: { id: In(page) } });
      if (person?.email) {
        await tx.delete(Invite, { email: person.email, status: InviteStatus.Sent, project: { id: In(page) } });
      }
    }
    await tx.delete(OrganizationUser, { id: membership.id });
    await recountSeats(tx, membership.organizationId);
    await closeIfEmpty(tx, membership.organizationId);
  }

  /** Makes another member the owner; the previous owner becomes an admin. */
  async transferOwnership(organizationId: string, ownerUserId: string, newOwnerUserId: string): Promise<MemberView[]> {
    if (ownerUserId === newOwnerUserId) {
      throw new BadRequestException('you are the owner already');
    }
    await readCommittedTransaction(this.members.manager, async tx => {
      await lockOrganization(tx, organizationId);
      const owner = await tx.findOne(OrganizationUser, { where: { organizationId, userId: ownerUserId } });
      if (owner?.role !== OrganizationRole.Owner) {
        throw new OrganizationException(HttpStatus.FORBIDDEN, 'owner_required', 'Only the owner can transfer the ownership');
      }
      const next = await tx.findOne(OrganizationUser, { where: { organizationId, userId: newOwnerUserId } });
      if (!next) {
        throw new NotFoundException('member not found');
      }
      await tx.update(OrganizationUser, { id: owner.id }, { role: OrganizationRole.Admin });
      await tx.update(OrganizationUser, { id: next.id }, { role: OrganizationRole.Owner });
    });
    return this.listMembers(organizationId);
  }

  async listInvites(organizationId: string): Promise<InviteView[]> {
    const invites = await this.invites.find({
      where: { organizationId, status: InviteStatus.Sent },
      order: { date: { created: 'ASC' }, id: 'ASC' },
    });
    return invites.map(inviteView);
  }

  /**
   * Invites an email. An account that proved it reads this email joins at once (as with project invites); anyone else
   * gets an invitation link, sent by email and also answered here for the admin to share. Inviting the same email again
   * sends a new link and the previous one stops working.
   */
  async invite(
    organization: Organization,
    invitedBy: User,
    payload: { email: string; role: OrganizationRole },
  ): Promise<{ member: MemberView } | { invite: InviteView & { inviteUrl: string } }> {
    if (payload.role !== OrganizationRole.Admin && payload.role !== OrganizationRole.Member) {
      throw new BadRequestException('role must be admin or member');
    }
    const email = normalizeEmail(payload.email);
    const account = await this.users.findOne({ where: { email } });
    if (account && (await this.members.exists({ where: { organizationId: organization.id, userId: account.id } }))) {
      throw new ConflictException('this person is a member already');
    }

    if (account?.emailVerified) {
      const added = await readCommittedTransaction(this.members.manager, async tx => {
        // The account read again under its lock (then the organization's, as acceptInvites does): an email changed
        // meanwhile is unverified, and the address asked for then gets an invitation instead
        const current = await tx.findOne(User, {
          where: { id: account.id },
          ...(isDbType(DbType.BETTER_SQLITE3) ? {} : { lock: { mode: 'pessimistic_write' as const } }),
        });
        if (current?.email !== email || !current.emailVerified) {
          return null;
        }
        const locked = await this.assertStillOpen(tx, organization.id);
        // A seat of the plan (402 plan_limit_reached), counted under the organization lock
        await assertSeatAvailable(tx, locked, { email, userId: current.id }, 'member');
        await tx.save(tx.create(OrganizationUser, { organizationId: organization.id, userId: current.id, role: payload.role }));
        // An invitation sent before they had an account is no longer needed
        await tx.delete(OrganizationInvite, { organizationId: organization.id, email });
        await recountSeats(tx, organization.id);
        return current;
      });
      if (added) {
        void this.mail.addedToOrganization(added, organization, payload.role);
        return { member: { userId: added.id, name: added.name, email: added.email, role: payload.role } };
      }
    }

    const token = generateInviteToken();
    const saved = await readCommittedTransaction(this.invites.manager, async tx => {
      const locked = await this.assertStillOpen(tx, organization.id);
      // A pending invitation takes a seat too, unless this person holds one already (a new link for the same email)
      await assertSeatAvailable(tx, locked, { email, userId: account?.id }, 'invite');
      const existing = await tx.findOne(OrganizationInvite, { where: { organizationId: organization.id, email } });
      const record = existing ?? tx.create(OrganizationInvite, { organizationId: organization.id, email });
      record.role = payload.role;
      record.status = InviteStatus.Sent;
      record.tokenHash = hashInviteToken(token);
      record.invitedByUserId = invitedBy.id;
      const invite = await tx.save(record);
      await recountSeats(tx, organization.id);
      return invite;
    });
    const inviteUrl = organizationInviteSignupUrl(token);
    void this.mail.invitedToOrganization(saved, organization, inviteUrl);
    return { invite: { ...inviteView(saved), inviteUrl } };
  }

  /** The plan, seats and strings of the organization, counted now (DESIGN §3.6) */
  usage(organization: Organization): Promise<OrganizationUsage> {
    return organizationUsage(this.organizations.manager, organization);
  }

  async revokeInvite(organizationId: string, inviteId: string): Promise<void> {
    await readCommittedTransaction(this.invites.manager, async tx => {
      // The organization first, as an acceptance takes it before it updates the invitation: a revoke deleting the
      // invitation and then recounting under the lock would wait for the acceptance in a cycle
      await lockOrganization(tx, organizationId);
      const invite = await tx.findOne(OrganizationInvite, { where: { id: inviteId, organizationId } });
      if (!invite) {
        throw new NotFoundException('invite not found');
      }
      await tx.delete(OrganizationInvite, { id: invite.id });
      await recountSeats(tx, organizationId);
    });
  }

  /** The pending organization invitations of an email, of active organizations. */
  async pendingInvites(email: string): Promise<OrganizationInvite[]> {
    const invites = await this.invites.find({
      where: { email: normalizeEmail(email), status: InviteStatus.Sent },
      relations: ['organization'],
    });
    return invites.filter(invite => invite.organization?.status === OrganizationStatus.Active);
  }

  /** The pending invitation of a token, when it is for this email (the link only works for the email it was sent to). */
  async inviteForToken(token: string, email: string): Promise<OrganizationInvite | null> {
    const invite = await this.invites.findOne({
      where: { tokenHash: hashInviteToken(token), status: InviteStatus.Sent },
      relations: ['organization'],
    });
    if (!invite || invite.email !== normalizeEmail(email) || !(await isOpenForMembers(this.invites.manager, invite.organizationId))) {
      return null;
    }
    return invite;
  }

  /**
   * Turns pending organization invites into memberships, each only if it is still exactly as the caller read it (an
   * admin may have sent a new link, changed the role or revoked it) and only while the account still has the email it
   * was sent to. A person who is a member already keeps their role. Returns the accepted ones.
   *
   * An invitation the organization's seats cannot take now (over the limit of its plan, DESIGN §3.6) stays pending:
   * `onLimit: 'refuse'` answers 402 `plan_limit_reached` instead, for the acceptance the person asked for; the
   * acceptances that come with a sign-up or a sign-in skip it, so the account is still made.
   */
  async acceptInvites(invites: OrganizationInvite[], user: User, options: { onLimit?: 'skip' | 'refuse' } = {}): Promise<AcceptedInvite[]> {
    if (invites.length === 0) {
      return [];
    }
    return readCommittedTransaction(this.invites.manager, async tx => {
      const current = await tx.findOne(User, {
        where: { id: user.id },
        select: ['id', 'email'],
        ...(isDbType(DbType.BETTER_SQLITE3) ? {} : { lock: { mode: 'pessimistic_write' as const } }),
      });
      const accepted: AcceptedInvite[] = [];
      // The organizations in the order of their ids, after the account: the global lock order (see lockOrganization)
      for (const invite of [...invites].sort((a, b) => byCodeUnits(a.organizationId, b.organizationId))) {
        if (current?.email !== invite.email) {
          continue;
        }
        const organization = await lockOrganization(tx, invite.organizationId);
        // Only into an active organization that has its owner (a closed one has no pending invites left anyway)
        if (!organization || !(await isOpenForMembers(tx, invite.organizationId))) {
          continue;
        }
        const refusal = await seatRefusal(tx, organization, { email: invite.email, userId: user.id }, 'member');
        if (refusal) {
          if (options.onLimit === 'refuse') {
            throw refusal;
          }
          continue;
        }
        const { affected } = await tx.update(
          OrganizationInvite,
          { id: invite.id, status: InviteStatus.Sent, role: invite.role, tokenHash: invite.tokenHash ?? IsNull() },
          { status: InviteStatus.Accepted, tokenHash: null },
        );
        if (!affected) {
          continue;
        }
        const existing = await tx.findOne(OrganizationUser, { where: { organizationId: invite.organizationId, userId: user.id } });
        let role = invite.role;
        if (!existing) {
          await tx.save(tx.create(OrganizationUser, { organizationId: invite.organizationId, userId: user.id, role }));
        } else if (outranks(invite.role, existing.role)) {
          // A membership made first by a project invite (as a member) gets the role this invitation grants
          await tx.update(OrganizationUser, { id: existing.id }, { role });
        } else {
          // Never lowered: a higher role stays
          role = existing.role;
        }
        await recountSeats(tx, invite.organizationId);
        accepted.push({ invite, role });
      }
      return accepted;
    });
  }

  /**
   * Locks the organization and refuses a write into one that is no longer open (closed by its last member's account
   * deletion, or suspended, after the request was authorized).
   */
  private async assertStillOpen(tx: EntityManager, organizationId: string): Promise<Organization> {
    const organization = await lockOrganization(tx, organizationId);
    if (!organization || !(await isOpenForMembers(tx, organizationId))) {
      throw new NotFoundException('organization not found');
    }
    return organization;
  }

  private async memberView(organizationId: string, userId: string): Promise<MemberView> {
    const membership = await this.members.findOneOrFail({ where: { organizationId, userId }, relations: ['user'] });
    return { userId: membership.user.id, name: membership.user.name, email: membership.user.email, role: membership.role };
  }
}
