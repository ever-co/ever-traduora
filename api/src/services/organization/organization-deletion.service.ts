import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OrganizationRole } from '../../domain/organization-actions';
import { Organization } from '../../entity/organization.entity';
import { User } from '../../entity/user.entity';
import { OrganizationException } from '../../errors';
import { lockAccountRow, lockProjects, readCommittedTransaction } from '../../utils/database-locks';
import { settleBillingCancellations } from './billing-cancellation';
import { assertDeletionConfirmed, deleteOrganizationData, lockOrganization, projectIdsOfOrganizations } from './organization-membership';
import { assertOrganizationOpen, membershipOf } from './organization-scope';

/**
 * An owner deletes their organization (DESIGN §3.9, `DELETE /organizations/:id`), confirmed by typing its slug:
 * 1. one transaction in the global lock order, account → projects → organization, checks everything under the locks
 *    (still active, still owned by the caller, the slug as typed, never the default organization), deletes the projects
 *    with everything in them, keeps the organization as a `deleted` tombstone without members or invitations, and
 *    queues the cancellation of its subscription;
 * 2. once that committed, the subscription is cancelled (`BillingCancellation`, P4), with retries; a refusal anywhere
 *    before the commit cancels nothing, and a cancellation that keeps failing is left to the operators.
 */
@Injectable()
export class OrganizationDeletion {
  constructor(
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    private readonly moduleRef: ModuleRef,
  ) {}

  async deleteByOwner(owner: User, organizationId: string, typedSlug: string): Promise<void> {
    await readCommittedTransaction(this.organizations.manager, async tx => {
      // The owner's account (its project count changes), then the projects, then the organization
      const account = await lockAccountRow(tx, owner.id);
      await lockProjects(tx, await projectIdsOfOrganizations(tx, [organizationId]));
      const locked = await lockOrganization(tx, organizationId);
      if (!locked) {
        throw new NotFoundException('organization not found');
      }
      // Decided on the rows as they are now: suspended or deleted meanwhile, renamed, or handed over
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
    // After the commit only: the data is gone, so the subscription goes too
    await settleBillingCancellations(this.moduleRef, this.organizations.manager, [organizationId]);
  }
}
