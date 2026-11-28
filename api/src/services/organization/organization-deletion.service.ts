import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationRole } from '../../domain/organization-actions';
import { Organization } from '../../entity/organization.entity';
import { User } from '../../entity/user.entity';
import { OrganizationException } from '../../errors';
import { lockAccountRow, lockProjects, readCommittedTransaction } from '../../utils/database-locks';
import { cancelSubscriptions } from './billing-cancellation';
import { assertDeletionConfirmed, deleteOrganizationData, lockOrganization, projectIdsOfOrganizations } from './organization-membership';
import { assertOrganizationOpen, membershipOf } from './organization-scope';

/**
 * An owner deletes their organization (DESIGN §3.9, `DELETE /organizations/:id`), confirmed by typing its slug:
 * 1. its subscription is cancelled (`BillingCancellation`, P4; nothing without billing), before anything is deleted;
 * 2. its projects are deleted with everything in them, in the global lock order account → projects → organization;
 * 3. it is marked `deleted` and its row kept as a tombstone, without members or invitations.
 * The default organization is never deleted.
 */
@Injectable()
export class OrganizationDeletion {
  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    private readonly moduleRef: ModuleRef,
  ) {}

  async deleteByOwner(owner: User, organizationId: string, typedSlug: string): Promise<void> {
    const organization = await this.organizations.findOne({ where: { id: organizationId } });
    if (!organization) {
      throw new NotFoundException('organization not found');
    }
    assertDeletionConfirmed(organization, typedSlug);
    // Outside the transaction: billing may call Stripe. A failure there stops the deletion before anything is deleted
    await cancelSubscriptions(this.moduleRef, [organization]);

    await readCommittedTransaction(this.organizations.manager, async tx => {
      // The owner's account (its project count changes), then the projects, then the organization
      const account = await lockAccountRow(tx, owner.id);
      await lockProjects(tx, await projectIdsOfOrganizations(tx, [organizationId]));
      const locked = await lockOrganization(tx, organizationId);
      // Decided again on the rows as they are now: suspended or deleted meanwhile, renamed, or handed over
      assertOrganizationOpen(locked, 'organization not found');
      assertDeletionConfirmed(locked, typedSlug);
      const membership = await membershipOf(tx, organizationId, owner.id);
      if (membership?.role !== OrganizationRole.Owner) {
        throw new OrganizationException(HttpStatus.FORBIDDEN, 'owner_required', 'Only the owner can delete the organization');
      }
      const projects = await deleteOrganizationData(tx, organizationId);
      // As a project deletion does, the deleting person's project count goes down with the projects
      if (account && projects > 0) {
        const current = await tx.findOne(User, { where: { id: owner.id }, select: ['id', 'numProjectsCreated'] });
        await tx.update(User, { id: owner.id }, { numProjectsCreated: Math.max(0, (current?.numProjectsCreated ?? 0) - projects) });
      }
    });
  }
}
