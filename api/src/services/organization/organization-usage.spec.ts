import { config } from '../../config';
import { OrganizationPlanCode } from '../../domain/organization-actions';
import { Organization } from '../../entity/organization.entity';
import { lockOrganizationForStrings } from './organization-membership';
import { assertProjectStrings, recountSeats, recountStrings, seatAvailable, usesOrganizationPlan } from './organization-usage';

/** An entity manager whose string total of the other projects is `others` */
function managerSumming(others: number) {
  const query: any = {
    select: () => query,
    where: () => query,
    andWhere: () => query,
    getRawOne: async () => ({ total: String(others) }),
  };
  return { createQueryBuilder: () => query } as any;
}

const organization = (planCode: OrganizationPlanCode, isDefault = false) => ({ id: 'org', planCode, isDefault }) as Organization;

describe('organization usage', () => {
  const saasBefore = config.saasEnabled;
  beforeEach(() => (config.saasEnabled = true));
  afterAll(() => (config.saasEnabled = saasBefore));

  it('limits an organization by its plan only in SaaS mode, and never the default organization', () => {
    expect(usesOrganizationPlan(organization(OrganizationPlanCode.Starter))).toBe(true);
    expect(usesOrganizationPlan(organization(OrganizationPlanCode.Starter, true))).toBe(false);
    expect(usesOrganizationPlan(null)).toBe(false);
    config.saasEnabled = false;
    expect(usesOrganizationPlan(organization(OrganizationPlanCode.Starter))).toBe(false);
  });

  describe('a seat', () => {
    const someone = { member: false, invited: false };
    const invited = { member: false, invited: true };
    const member = { member: true, invited: false };

    it('is given to someone new while one is free, and refused when the seats are taken', () => {
      expect(seatAvailable(15, 14, someone, 'invite')).toBe(true);
      expect(seatAvailable(15, 14, someone, 'member')).toBe(true);
      expect(seatAvailable(15, 15, someone, 'invite')).toBe(false);
      expect(seatAvailable(15, 15, someone, 'member')).toBe(false);
    });

    it('is not needed by a member, nor by someone who holds one (a new link, an acceptance at the limit)', () => {
      expect(seatAvailable(15, 15, member, 'member')).toBe(true);
      expect(seatAvailable(15, 15, invited, 'invite')).toBe(true);
      expect(seatAvailable(15, 15, invited, 'member')).toBe(true);
    });

    it('is refused to an acceptance over the limit, after a downgrade; a new link still goes out', () => {
      expect(seatAvailable(15, 17, invited, 'member')).toBe(false);
      expect(seatAvailable(15, 17, invited, 'invite')).toBe(true);
    });

    it('is always there without a limit', () => {
      expect(seatAvailable(null, 10_000, someone, 'member')).toBe(true);
    });
  });

  describe('strings', () => {
    const starter = organization(OrganizationPlanCode.Starter);

    it('are refused past the limit, counted with the other projects', async () => {
      await expect(assertProjectStrings(managerSumming(9_000), starter, 'p2', 800, 1_000, null)).resolves.toBeUndefined();
      await expect(assertProjectStrings(managerSumming(9_000), starter, 'p2', 800, 1_001, null)).rejects.toMatchObject({
        resource: 'strings',
        limit: 10_000,
      });
    });

    it('always pass a change that adds none, and an organization without a strings limit', async () => {
      await expect(assertProjectStrings(managerSumming(20_000), starter, 'p2', 10, 10, null)).resolves.toBeUndefined();
      await expect(assertProjectStrings(managerSumming(20_000), starter, 'p2', 10, 5, null)).resolves.toBeUndefined();
      await expect(
        assertProjectStrings(managerSumming(20_000), organization(OrganizationPlanCode.SmallBusiness), 'p2', 0, 1_000, null),
      ).resolves.toBeUndefined();
    });
  });

  describe('the organization lock for strings', () => {
    it('is never taken for the default organization, nor on a single-tenant install', async () => {
      const manager: any = { findOne: jest.fn() };
      expect(await lockOrganizationForStrings(manager, { organizationId: 'org', organization: { isDefault: true } })).toBeNull();
      config.saasEnabled = false;
      expect(await lockOrganizationForStrings(manager, { organizationId: 'org', organization: { isDefault: false } })).toBeNull();
      expect(manager.findOne).not.toHaveBeenCalled();
    });

    it('is taken for an organization with its own plan, which it answers', async () => {
      const row = organization(OrganizationPlanCode.Starter);
      const manager: any = { findOne: jest.fn(async () => row) };
      expect(await lockOrganizationForStrings(manager, { organizationId: 'org', organization: { isDefault: false } })).toBe(row);
      expect(manager.findOne).toHaveBeenCalledTimes(1);
    });
  });

  describe('the cached counters', () => {
    it('are not kept on a single-tenant install: nothing is read or written', async () => {
      config.saasEnabled = false;
      const manager: any = { findOne: jest.fn(), update: jest.fn(), count: jest.fn(), createQueryBuilder: jest.fn() };
      await recountSeats(manager, 'org');
      await recountStrings(manager, 'org');
      expect([manager.findOne, manager.update, manager.count, manager.createQueryBuilder].map(fn => fn.mock.calls.length)).toEqual([0, 0, 0, 0]);
    });

    it('are not kept for the default organization in SaaS mode', async () => {
      const manager: any = { findOne: jest.fn(async () => ({ id: 'org', isDefault: true })), update: jest.fn(), count: jest.fn() };
      await recountSeats(manager, 'org');
      await recountStrings(manager, 'org');
      expect(manager.update).not.toHaveBeenCalled();
      expect(manager.count).not.toHaveBeenCalled();
    });
  });
});
