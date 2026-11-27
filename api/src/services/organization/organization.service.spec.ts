import { BadRequestException, NotFoundException } from '@nestjs/common';
import { config } from '../../config';
import { OrganizationPlanCode, OrganizationRole, OrganizationStatus } from '../../domain/organization-actions';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { OrganizationException } from '../../errors';
import { inTransaction, isDuplicateKey, personalOrganizationName } from './organization-membership';
import { assertSaasEnabled, OrganizationService, organizationView } from './organization.service';

/** A transaction manager over a list of memberships, enough for the owner rules. */
function fakeManager(memberships: OrganizationUser[]) {
  const tx: any = {
    queryRunner: { isTransactionActive: true },
    findOne: jest.fn(async (entity, options) => {
      if (entity === OrganizationUser) {
        return memberships.find(m => m.organizationId === options.where.organizationId && m.userId === options.where.userId) ?? null;
      }
      return Object.assign(new Organization(), { id: options.where.id });
    }),
    update: jest.fn(async (entity, where, changes) => {
      const row = memberships.find(m => m.id === where.id);
      Object.assign(row, changes);
      return { affected: row ? 1 : 0 };
    }),
  };
  tx.transaction = async work => work(tx);
  return tx;
}

function serviceOver(memberships: OrganizationUser[]) {
  const manager = fakeManager(memberships);
  const members: any = {
    manager,
    find: jest.fn(async ({ where }) =>
      memberships
        .filter(m => m.organizationId === where.organizationId)
        .map(m => ({ ...m, user: { id: m.userId, name: m.userId, email: `${m.userId}@test.com` } })),
    ),
    findOneOrFail: jest.fn(async ({ where }) => {
      const m = memberships.find(row => row.organizationId === where.organizationId && row.userId === where.userId);
      return { ...m, user: { id: m.userId, name: m.userId, email: `${m.userId}@test.com` } };
    }),
  };
  return new OrganizationService({ manager } as any, members, { manager } as any, {} as any, {} as any);
}

const member = (userId: string, role: OrganizationRole): OrganizationUser =>
  Object.assign(new OrganizationUser(), { id: `m-${userId}`, organizationId: 'org-1', userId, role });

describe('OrganizationService owner rules', () => {
  it('changes a role to admin or member only, never the own role nor the owner', async () => {
    const rows = [member('owner', OrganizationRole.Owner), member('ann', OrganizationRole.Member)];
    const organizations = serviceOver(rows);
    expect((await organizations.changeRole('org-1', 'owner', 'ann', OrganizationRole.Admin)).role).toBe(OrganizationRole.Admin);
    await expect(organizations.changeRole('org-1', 'ann', 'owner', OrganizationRole.Member)).rejects.toBeInstanceOf(OrganizationException);
    await expect(organizations.changeRole('org-1', 'owner', 'ann', OrganizationRole.Owner)).rejects.toBeInstanceOf(BadRequestException);
    await expect(organizations.changeRole('org-1', 'ann', 'ann', OrganizationRole.Member)).rejects.toBeInstanceOf(BadRequestException);
    await expect(organizations.changeRole('org-1', 'owner', 'nobody', OrganizationRole.Member)).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.filter(m => m.role === OrganizationRole.Owner)).toHaveLength(1);
  });

  it('transfers the ownership so that there is exactly one owner', async () => {
    const rows = [member('owner', OrganizationRole.Owner), member('ann', OrganizationRole.Admin), member('bo', OrganizationRole.Member)];
    const organizations = serviceOver(rows);
    await organizations.transferOwnership('org-1', 'owner', 'bo');
    expect(Object.fromEntries(rows.map(m => [m.userId, m.role]))).toEqual({ owner: 'admin', ann: 'admin', bo: 'owner' });
    // Only the owner transfers, to a member, never to themselves
    await expect(organizations.transferOwnership('org-1', 'owner', 'ann')).rejects.toBeInstanceOf(OrganizationException);
    await expect(organizations.transferOwnership('org-1', 'bo', 'nobody')).rejects.toBeInstanceOf(NotFoundException);
    await expect(organizations.transferOwnership('org-1', 'bo', 'bo')).rejects.toBeInstanceOf(BadRequestException);
    expect(rows.filter(m => m.role === OrganizationRole.Owner)).toHaveLength(1);
  });

  it('never removes the owner', async () => {
    const organizations = serviceOver([member('owner', OrganizationRole.Owner)]);
    await expect(organizations.removeMember('org-1', 'owner', 'owner')).rejects.toBeInstanceOf(OrganizationException);
  });
});

describe('organization helpers', () => {
  const saas = config.saasEnabled;
  afterEach(() => (config.saasEnabled = saas));

  it('answers 404 saas_disabled outside SaaS mode', () => {
    config.saasEnabled = false;
    expect(() => assertSaasEnabled()).toThrow(OrganizationException);
    config.saasEnabled = true;
    expect(() => assertSaasEnabled()).not.toThrow();
  });

  it('names a personal organization after the person, within 80 characters', () => {
    expect(personalOrganizationName('Ada Lovelace')).toBe("Ada Lovelace's organization");
    expect(personalOrganizationName('  ')).toBe('My organization');
    expect(personalOrganizationName('x'.repeat(200)).length).toBeLessThanOrEqual(80);
  });

  it('tells duplicate keys of every engine', () => {
    expect(isDuplicateKey({ code: '23505' })).toBe(true);
    expect(isDuplicateKey({ driverError: { code: 'ER_DUP_ENTRY' } })).toBe(true);
    expect(isDuplicateKey({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true);
    expect(isDuplicateKey({ message: 'UNIQUE constraint failed: organization.slug' })).toBe(true);
    expect(isDuplicateKey({ code: 'ECONNRESET' })).toBe(false);
    expect(isDuplicateKey(null)).toBe(false);
  });

  it("joins the caller's transaction instead of starting one", async () => {
    const inside: any = { queryRunner: { isTransactionActive: true }, transaction: jest.fn() };
    expect(await inTransaction(inside, async tx => tx === inside)).toBe(true);
    expect(inside.transaction).not.toHaveBeenCalled();
    const outside: any = { transaction: jest.fn(async work => work('tx')) };
    expect(await inTransaction(outside, async tx => tx)).toBe('tx');
  });

  it('answers an organization without its counters or billing fields', () => {
    const organization = Object.assign(new Organization(), {
      id: 'o',
      name: 'Acme',
      slug: 'acme',
      status: OrganizationStatus.Active,
      planCode: OrganizationPlanCode.Starter,
      isDefault: false,
      adminsSeeAllProjects: true,
      seatsUsed: 3,
      stringsUsed: 10,
      date: { created: new Date(0), modified: new Date(0) },
    });
    expect(Object.keys(organizationView(organization, OrganizationRole.Owner)).sort()).toEqual(
      ['adminsSeeAllProjects', 'date', 'id', 'isDefault', 'name', 'planCode', 'role', 'slug', 'status'].sort(),
    );
  });
});
