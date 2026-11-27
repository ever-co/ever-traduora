/**
 * What a member of an organization may do there, by their organization role. Default-deny, like `actions.ts`: an
 * action that no set below names is refused to everyone, and an unknown role can do nothing.
 *
 * Project roles (`actions.ts`) stay as they are inside the organization. In SaaS mode an organization `owner` or
 * `admin` is also an implicit project `admin` on every project of the organization (DESIGN §3.2, OD-T9).
 */
export enum OrganizationRole {
  Owner = 'owner',
  Admin = 'admin',
  Member = 'member',
}

export enum OrganizationAction {
  ViewOrganization = 'ViewOrganization',
  EditOrganization = 'EditOrganization',
  DeleteOrganization = 'DeleteOrganization',
  ViewMembers = 'ViewMembers',
  EditMembers = 'EditMembers',
  TransferOwnership = 'TransferOwnership',
  CreateProject = 'CreateProject',
  ManageBilling = 'ManageBilling',
  ExportOrganization = 'ExportOrganization',
}

export const AllowedMemberActions: ReadonlySet<OrganizationAction> = new Set([
  OrganizationAction.ViewOrganization,
  OrganizationAction.ViewMembers,
  OrganizationAction.CreateProject,
]);

export const AllowedAdminActions: ReadonlySet<OrganizationAction> = new Set([
  ...AllowedMemberActions,
  OrganizationAction.EditOrganization,
  OrganizationAction.EditMembers,
  OrganizationAction.ManageBilling,
  OrganizationAction.ExportOrganization,
]);

export const AllowedOwnerActions: ReadonlySet<OrganizationAction> = new Set([
  ...AllowedAdminActions,
  OrganizationAction.DeleteOrganization,
  OrganizationAction.TransferOwnership,
]);

export function isOrganizationActionAllowed(role: OrganizationRole | string | undefined | null, action: OrganizationAction): boolean {
  switch (role) {
    case OrganizationRole.Owner:
      return AllowedOwnerActions.has(action);
    case OrganizationRole.Admin:
      return AllowedAdminActions.has(action);
    case OrganizationRole.Member:
      return AllowedMemberActions.has(action);
    default:
      return false;
  }
}

/** Whether the role makes its holder an implicit project admin on every project of the organization (SaaS mode). */
export function isImplicitProjectAdmin(role: OrganizationRole | string | undefined | null): boolean {
  return role === OrganizationRole.Owner || role === OrganizationRole.Admin;
}

export enum OrganizationStatus {
  Active = 'active',
  Suspended = 'suspended',
  Deleted = 'deleted',
}

/** The organization plans (DESIGN §3.6). Their limits come with P3; P1 stores the code only. */
export enum OrganizationPlanCode {
  Starter = 'starter',
  SmallBusiness = 'small_business',
  Enterprise = 'enterprise',
}
