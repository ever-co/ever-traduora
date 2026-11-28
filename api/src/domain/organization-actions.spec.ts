import {
  AllowedAdminActions,
  AllowedMemberActions,
  AllowedOwnerActions,
  isImplicitProjectAdmin,
  isOrganizationActionAllowed,
  OrganizationAction,
  OrganizationRole,
} from './organization-actions';

describe('the organization action table', () => {
  const all = Object.values(OrganizationAction);

  // The whole table, written out: a change to who may do what must change this spec too
  const expected: Record<OrganizationRole, OrganizationAction[]> = {
    [OrganizationRole.Owner]: all,
    [OrganizationRole.Admin]: [
      OrganizationAction.ViewOrganization,
      OrganizationAction.EditOrganization,
      OrganizationAction.ViewMembers,
      OrganizationAction.EditMembers,
      OrganizationAction.CreateProject,
      OrganizationAction.ViewBilling,
      OrganizationAction.ExportOrganization,
      OrganizationAction.ViewUsage,
    ],
    [OrganizationRole.Member]: [OrganizationAction.ViewOrganization, OrganizationAction.ViewMembers, OrganizationAction.CreateProject],
  };

  for (const role of Object.values(OrganizationRole)) {
    for (const action of all) {
      const allowed = expected[role].includes(action);
      it(`${allowed ? 'lets' : 'refuses'} ${role} ${action}`, () => {
        expect(isOrganizationActionAllowed(role, action)).toBe(allowed);
      });
    }
  }

  it('refuses everything to an unknown or missing role (default deny)', () => {
    for (const action of all) {
      expect(isOrganizationActionAllowed('superuser', action)).toBe(false);
      expect(isOrganizationActionAllowed(undefined, action)).toBe(false);
      expect(isOrganizationActionAllowed(null, action)).toBe(false);
    }
  });

  it('nests the roles: what a member may do an admin may, and what an admin may the owner may', () => {
    for (const action of AllowedMemberActions) {
      expect(AllowedAdminActions.has(action)).toBe(true);
    }
    for (const action of AllowedAdminActions) {
      expect(AllowedOwnerActions.has(action)).toBe(true);
    }
  });

  it('keeps the transfer of ownership, the deletion and billing changes to the owner', () => {
    expect(AllowedAdminActions.has(OrganizationAction.TransferOwnership)).toBe(false);
    expect(AllowedAdminActions.has(OrganizationAction.ManageBilling)).toBe(false);
    expect(AllowedAdminActions.has(OrganizationAction.DeleteOrganization)).toBe(false);
  });

  it('makes only owners and admins implicit project admins', () => {
    expect(isImplicitProjectAdmin(OrganizationRole.Owner)).toBe(true);
    expect(isImplicitProjectAdmin(OrganizationRole.Admin)).toBe(true);
    expect(isImplicitProjectAdmin(OrganizationRole.Member)).toBe(false);
    expect(isImplicitProjectAdmin(undefined)).toBe(false);
  });
});
