/** Another member of a project or an organization, a candidate for its admin role or its ownership. */
export interface DeletionCandidate {
  userId: string;
  name: string;
  email: string;
  role: string;
}

/** A project where the person is the last admin while others use it: one of them becomes its admin. */
export interface DeletionProject {
  id: string;
  name: string;
  organizationId: string;
  members: DeletionCandidate[];
}

/**
 * A non-default organization the person owns. With other members, one of them becomes the owner; as the only member, the
 * organization and its projects are deleted with the account, confirmed by its address.
 */
export interface DeletionOrganization {
  id: string;
  name: string;
  slug: string;
  status: 'active' | 'suspended' | 'deleted';
  projectsCount: number;
  onlyMember: boolean;
  members: DeletionCandidate[];
}

/** `GET /users/me/deletion`: what stands in the way of deleting the account. Both empty: nothing to decide. */
export interface AccountDeletionPreflight {
  projects: DeletionProject[];
  organizations: DeletionOrganization[];
}

/** The optional body of `DELETE /users/me`: the person's choices, applied in one transaction with the deletion. */
export interface AccountDeletionChoices {
  projectAdmins?: { projectId: string; userId: string }[];
  organizationOwners?: { organizationId: string; userId: string }[];
  deleteOrganizations?: { organizationId: string; slug: string }[];
}
