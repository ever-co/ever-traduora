import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ProjectAction } from '../domain/actions';
import { OrganizationAction, OrganizationRole, OrganizationStatus } from '../domain/organization-actions';
import { OrganizationUser } from '../entity/organization-user.entity';
import { Organization } from '../entity/organization.entity';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { Project } from '../entity/project.entity';
import { User } from '../entity/user.entity';
import { OrganizationException } from '../errors';
import AuthorizationService, { assertOrganizationOpen, effectiveProjectRole } from './authorization.service';

const organization = (fields: Partial<Organization> = {}): Organization =>
  Object.assign(new Organization(), { id: 'org-1', status: OrganizationStatus.Active, adminsSeeAllProjects: true, ...fields });

const project = (org: Organization | undefined): Project =>
  Object.assign(new Project(), {
    id: 'project-1',
    organizationId: org?.id,
    organization: org,
    termsCount: 0,
    localesCount: 0,
    plan: { maxStrings: 100 },
  });

const user = Object.assign(new User(), { id: 'user-1', email: 'user@test.com' });

/** An AuthorizationService over fixed rows. */
function service(rows: { project?: Project; projectRole?: ProjectRole; organizationRole?: OrganizationRole; client?: boolean }) {
  const projectUserRepo = {
    findOne: jest.fn(async () =>
      rows.project && rows.projectRole ? Object.assign(new ProjectUser(), { id: 'pu-1', role: rows.projectRole, project: rows.project, user }) : null,
    ),
  };
  const membership = () =>
    rows.organizationRole
      ? Object.assign(new OrganizationUser(), {
          organizationId: rows.project?.organizationId ?? 'org-1',
          userId: user.id,
          role: rows.organizationRole,
          organization: rows.project?.organization ?? organization(),
        })
      : null;
  // The organization scope reads through the entity manager: the project a route names, and memberships
  const manager = { findOne: jest.fn(async entity => (entity === Project ? (rows.project ?? null) : membership())) };
  const organizationUserRepo = { manager };
  const projectClientRepo = {
    findOne: jest.fn(async () =>
      rows.client && rows.project ? Object.assign(new ProjectClient(), { id: 'client-1', role: ProjectRole.Viewer, project: rows.project }) : null,
    ),
  };
  return new AuthorizationService(projectClientRepo as any, projectUserRepo as any, organizationUserRepo as any);
}

describe('assertOrganizationOpen', () => {
  it('passes only an active organization', () => {
    expect(() => assertOrganizationOpen(organization(), 'nf')).not.toThrow();
    expect(() => assertOrganizationOpen(undefined, 'nf')).toThrow(ForbiddenException);
    expect(() => assertOrganizationOpen(organization({ status: OrganizationStatus.Deleted }), 'nf')).toThrow(NotFoundException);
    expect(() => assertOrganizationOpen(organization({ status: 'weird' as OrganizationStatus }), 'nf')).toThrow(ForbiddenException);
    try {
      assertOrganizationOpen(organization({ status: OrganizationStatus.Suspended }), 'nf');
      fail('should throw');
    } catch (error) {
      expect(error).toBeInstanceOf(OrganizationException);
      expect(error.code).toBe('organization_suspended');
      expect(error.getStatus()).toBe(403);
    }
  });
});

describe('effectiveProjectRole', () => {
  const open = { adminsSeeAllProjects: true };
  const closed = { adminsSeeAllProjects: false };

  it('makes an owner or admin an implicit project admin only where the organization says so', () => {
    expect(effectiveProjectRole(undefined, OrganizationRole.Owner, open)).toBe(ProjectRole.Admin);
    expect(effectiveProjectRole(ProjectRole.Viewer, OrganizationRole.Admin, open)).toBe(ProjectRole.Admin);
    expect(effectiveProjectRole(undefined, OrganizationRole.Member, open)).toBeUndefined();
    expect(effectiveProjectRole(ProjectRole.Editor, OrganizationRole.Member, open)).toBe(ProjectRole.Editor);
    // The default organization of an upgraded install: exactly the access people had
    expect(effectiveProjectRole(undefined, OrganizationRole.Owner, closed)).toBeUndefined();
    expect(effectiveProjectRole(ProjectRole.Viewer, OrganizationRole.Owner, closed)).toBe(ProjectRole.Viewer);
    expect(effectiveProjectRole(undefined, OrganizationRole.Owner, undefined)).toBeUndefined();
  });
});

describe('AuthorizationService.authorizeProjectAction', () => {
  it('lets a project member of an active organization act with their project role', async () => {
    const auth = service({ project: project(organization()), projectRole: ProjectRole.Editor, organizationRole: OrganizationRole.Member });
    const membership = await auth.authorizeProjectAction(user, 'project-1', ProjectAction.EditTerm);
    expect(membership.role).toBe(ProjectRole.Editor);
    expect(membership.project.organization.id).toBe('org-1');
    await expect(auth.authorizeProjectAction(user, 'project-1', ProjectAction.DeleteProject)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a project member who is no longer a member of the organization', async () => {
    const auth = service({ project: project(organization()), projectRole: ProjectRole.Admin });
    await expect(auth.authorizeProjectAction(user, 'project-1', ProjectAction.ViewProject)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses everyone in a suspended or deleted organization, and a project without one', async () => {
    for (const status of [OrganizationStatus.Suspended, OrganizationStatus.Deleted]) {
      const auth = service({ project: project(organization({ status })), projectRole: ProjectRole.Admin, organizationRole: OrganizationRole.Owner });
      await expect(auth.authorizeProjectAction(user, 'project-1', ProjectAction.ViewProject)).rejects.toBeTruthy();
    }
    const orphan = service({ project: project(undefined), projectRole: ProjectRole.Admin, organizationRole: OrganizationRole.Owner });
    await expect(orphan.authorizeProjectAction(user, 'project-1', ProjectAction.ViewProject)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('tells a non-member nothing about the status of the organization', async () => {
    for (const status of [OrganizationStatus.Suspended, OrganizationStatus.Deleted, OrganizationStatus.Active]) {
      const auth = service({ project: project(organization({ status })) });
      const refused = auth.authorizeProjectAction(user, 'project-1', ProjectAction.ViewProject);
      await expect(refused).rejects.toBeInstanceOf(ForbiddenException);
      await expect(refused).rejects.not.toBeInstanceOf(OrganizationException);
    }
  });

  it('gives an organization owner or admin the admin role without a project membership', async () => {
    const auth = service({ project: project(organization()), organizationRole: OrganizationRole.Admin });
    const membership = await auth.authorizeProjectAction(user, 'project-1', ProjectAction.DeleteProject);
    expect(membership.role).toBe(ProjectRole.Admin);
    expect(membership.id).toBeUndefined();
  });

  it('gives an organization member no access without a project membership', async () => {
    const auth = service({ project: project(organization()), organizationRole: OrganizationRole.Member });
    await expect(auth.authorizeProjectAction(user, 'project-1', ProjectAction.ViewProject)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('gives the owner of the default organization no project they are not in', async () => {
    const auth = service({ project: project(organization({ adminsSeeAllProjects: false })), organizationRole: OrganizationRole.Owner });
    await expect(auth.authorizeProjectAction(user, 'project-1', ProjectAction.ViewProject)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('checks the organization of an API key through its project', async () => {
    const client = Object.assign(new ProjectClient(), { id: 'client-1' });
    const ok = service({ project: project(organization()), client: true });
    expect((await ok.authorizeProjectAction(client, 'project-1', ProjectAction.ViewTerm)).role).toBe(ProjectRole.Viewer);
    const suspended = service({ project: project(organization({ status: OrganizationStatus.Suspended })), client: true });
    await expect(suspended.authorizeProjectAction(client, 'project-1', ProjectAction.ViewTerm)).rejects.toBeInstanceOf(OrganizationException);
    const elsewhere = service({ project: project(organization()) });
    await expect(elsewhere.authorizeProjectAction(client, 'project-1', ProjectAction.ViewTerm)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuthorizationService.authorizeOrganizationAction', () => {
  it('answers the membership when the role allows the action', async () => {
    const auth = service({ organizationRole: OrganizationRole.Member });
    const membership = await auth.authorizeOrganizationAction(user, 'org-1', OrganizationAction.CreateProject);
    expect(membership.role).toBe(OrganizationRole.Member);
    await expect(auth.authorizeOrganizationAction(user, 'org-1', OrganizationAction.EditMembers)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('refuses a non-member', async () => {
    const auth = service({});
    await expect(auth.authorizeOrganizationAction(user, 'org-1', OrganizationAction.ViewOrganization)).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('AuthorizationService.authorizeAddingToOrganization', () => {
  /** Members of org-1: the caller with `callerRole`, and `member-1`. */
  const over = (callerRole: OrganizationRole | undefined) => {
    const manager = {
      findOne: jest.fn(async (_entity, { where }) => {
        if (where.userId === 'member-1') {
          return Object.assign(new OrganizationUser(), { role: OrganizationRole.Member });
        }
        return where.userId === user.id && callerRole ? Object.assign(new OrganizationUser(), { role: callerRole }) : null;
      }),
    };
    return new AuthorizationService({} as any, {} as any, { manager } as any);
  };

  it('lets anyone allowed to invite to the project add a member of the organization', async () => {
    await expect(over(OrganizationRole.Member).authorizeAddingToOrganization(user, organization(), 'member-1')).resolves.toBeUndefined();
  });

  it('keeps bringing new people in to the owner and the admins', async () => {
    for (const target of ['outsider', undefined]) {
      await expect(over(OrganizationRole.Admin).authorizeAddingToOrganization(user, organization(), target)).resolves.toBeUndefined();
      await expect(over(OrganizationRole.Owner).authorizeAddingToOrganization(user, organization(), target)).resolves.toBeUndefined();
      const refused = over(OrganizationRole.Member).authorizeAddingToOrganization(user, organization(), target);
      await expect(refused).rejects.toBeInstanceOf(OrganizationException);
      await expect(refused).rejects.toMatchObject({ code: 'organization_admin_required' });
    }
  });

  it('keeps the rule of a self-hosted install in the default organization', async () => {
    await expect(
      over(OrganizationRole.Member).authorizeAddingToOrganization(user, organization({ isDefault: true }), 'outsider'),
    ).resolves.toBeUndefined();
  });

  it('refuses any addition to an organization that is not active', async () => {
    const suspended = organization({ status: OrganizationStatus.Suspended });
    await expect(over(OrganizationRole.Owner).authorizeAddingToOrganization(user, suspended, 'member-1')).rejects.toBeInstanceOf(
      OrganizationException,
    );
  });
});
