import { config } from '../../config';
import { OrganizationPlanCode } from '../../domain/organization-actions';
import { InviteStatus } from '../../entity/invite.entity';
import { OrganizationInvite } from '../../entity/organization-invite.entity';
import { OrganizationUser } from '../../entity/organization-user.entity';
import { Organization } from '../../entity/organization.entity';
import { Project } from '../../entity/project.entity';
import { PlanLimitException } from '../../errors';
import { assertProjectStrings, countSeats, countStrings, seatRefusal, usesOrganizationPlan } from './organization-usage';

/** An entity manager that answers `find` from fixed rows, by entity */
function managerWith(rows: {
  members?: Array<{ userId: string; email: string }>;
  organizationInvites?: string[];
  projectInvites?: string[];
  projects?: Array<[string, number, number]>;
}) {
  return {
    find: async (entity: unknown) => {
      if (entity === OrganizationUser) {
        return (rows.members ?? []).map(member => ({ userId: member.userId, user: { email: member.email } }));
      }
      if (entity === OrganizationInvite) {
        return (rows.organizationInvites ?? []).map(email => ({ email, status: InviteStatus.Sent }));
      }
      if (entity === Project) {
        return (rows.projects ?? []).map(([id, localesCount, termsCount]) => ({ id, localesCount, termsCount }));
      }
      return (rows.projectInvites ?? []).map(email => ({ email, status: InviteStatus.Sent }));
    },
  } as any;
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

  it('counts a person once: members, then pending invitations of people who are not members', async () => {
    const manager = managerWith({
      members: [
        { userId: 'u1', email: 'one@test.com' },
        { userId: 'u2', email: 'two@test.com' },
      ],
      organizationInvites: ['three@test.com', 'two@TEST.com'],
      projectInvites: ['three@test.com', 'four@test.com', 'one@test.com'],
    });
    expect(await countSeats(manager, 'org')).toBe(4);
  });

  it('sums locales × terms over the projects', async () => {
    expect(
      await countStrings(
        managerWith({
          projects: [
            ['p1', 2, 10],
            ['p2', 0, 50],
            ['p3', 3, 3],
          ],
        }),
        'org',
      ),
    ).toBe(29);
  });

  describe('a seat', () => {
    const full = managerWith({
      members: [{ userId: 'owner', email: 'owner@test.com' }],
      organizationInvites: Array.from({ length: 14 }, (_, i) => `pending-${i}@test.com`),
    });
    const starter = organization(OrganizationPlanCode.Starter);

    it('is refused to someone new when the seats are taken', async () => {
      const refusal = await seatRefusal(full, starter, { email: 'new@test.com' }, 'invite');
      expect(refusal).toBeInstanceOf(PlanLimitException);
      expect(refusal).toMatchObject({ resource: 'seats', limit: 15, used: 15, plan: 'starter' });
      expect(await seatRefusal(full, starter, { email: 'new@test.com', userId: 'u-new' }, 'member')).toBeInstanceOf(PlanLimitException);
    });

    it('is not needed by a member, nor by someone who holds one (a new link, an acceptance at the limit)', async () => {
      expect(await seatRefusal(full, starter, { userId: 'owner' }, 'member')).toBeNull();
      expect(await seatRefusal(full, starter, { email: 'pending-3@test.com' }, 'invite')).toBeNull();
      expect(await seatRefusal(full, starter, { email: 'pending-3@Test.COM', userId: 'u3' }, 'member')).toBeNull();
    });

    it('is refused to an acceptance over the limit, after a downgrade', async () => {
      const over = managerWith({
        members: [{ userId: 'owner', email: 'owner@test.com' }],
        organizationInvites: Array.from({ length: 16 }, (_, i) => `pending-${i}@test.com`),
      });
      expect(await seatRefusal(over, starter, { email: 'pending-3@test.com', userId: 'u3' }, 'member')).toMatchObject({ used: 17, limit: 15 });
      // A new link takes nothing more, so it is still sent
      expect(await seatRefusal(over, starter, { email: 'pending-3@test.com' }, 'invite')).toBeNull();
    });

    it('is always there on Enterprise, in the default organization and in single-tenant mode', async () => {
      expect(await seatRefusal(full, organization(OrganizationPlanCode.Enterprise), { email: 'new@test.com' }, 'invite')).toBeNull();
      expect(await seatRefusal(full, organization(OrganizationPlanCode.Starter, true), { email: 'new@test.com' }, 'invite')).toBeNull();
      config.saasEnabled = false;
      expect(await seatRefusal(full, starter, { email: 'new@test.com' }, 'invite')).toBeNull();
    });
  });

  describe('strings', () => {
    const projects = managerWith({
      projects: [
        ['p1', 1, 9_000],
        ['p2', 2, 400],
      ],
    });
    const starter = organization(OrganizationPlanCode.Starter);

    it('are refused past the limit, counted with the other projects', async () => {
      await expect(assertProjectStrings(projects, starter, 'p2', 800, 1_000)).resolves.toBeUndefined();
      await expect(assertProjectStrings(projects, starter, 'p2', 800, 1_001)).rejects.toMatchObject({
        resource: 'strings',
        limit: 10_000,
        used: 9_800,
        plan: 'starter',
      });
    });

    it('always pass a change that adds none, and an organization without a strings limit', async () => {
      const over = managerWith({ projects: [['p1', 1, 20_000]] });
      await expect(assertProjectStrings(over, starter, 'p2', 10, 10)).resolves.toBeUndefined();
      await expect(assertProjectStrings(over, starter, 'p2', 10, 5)).resolves.toBeUndefined();
      await expect(assertProjectStrings(over, organization(OrganizationPlanCode.SmallBusiness), 'p2', 0, 1_000)).resolves.toBeUndefined();
    });
  });
});
