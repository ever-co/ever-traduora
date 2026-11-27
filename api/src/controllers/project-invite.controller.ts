import { Body, ConflictException, Controller, Delete, Get, HttpCode, HttpStatus, NotFoundException, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import {
  InviteUserRequest,
  ListInviteUsersResponse,
  ProjectInviteCreatedResponse,
  ProjectInviteResponse,
  UpdateProjectInviteRequest,
} from '../domain/http';
import { normalizeEmail } from '../domain/validators';
import { Invite, InviteStatus } from '../entity/invite.entity';
import { ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import AuthorizationService from '../services/authorization.service';
import { ensureMember, lockOrganization, recountSeats } from '../services/organization/organization-membership';
import { assertSeatAvailable } from '../services/organization/organization-usage';
import MailService from '../services/mail.service';
import { generateInviteToken, hashInviteToken, inviteSignupUrl } from '../utils/invite-token';
import { readCommittedTransaction } from '../utils/database-locks';
import { Access } from '../access/access.decorator';

@Controller('api/v1/projects')
@ApiTags('Project Invites')
export default class ProjectInviteController {
  constructor(
    private auth: AuthorizationService,
    private mail: MailService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Invite) private inviteRepo: Repository<Invite>,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
  ) {}

  @Access('project:ViewProjectInvites')
  @Get(':projectId/invites')
  @ApiOperation({ summary: 'List all invites with access to a project' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListInviteUsersResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewProjectInvites);

    const invites = await this.inviteRepo.find({
      where: { project: { id: projectId }, status: InviteStatus.Sent },
    });

    return {
      data: invites.map(invite => ({
        id: invite.id,
        role: invite.role,
        email: invite.email,
        status: invite.status,
      })),
    };
  }

  @Access('project:InviteProjectUser')
  @Post(':projectId/invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a new project invite' })
  @ApiResponse({
    status: HttpStatus.CREATED,
    description: 'Created: a project user for an account with a verified email, otherwise an invite with its link',
    type: ProjectInviteCreatedResponse,
  })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'The user is already part of the project' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Param('projectId') projectId: string, @Body() inviteUserRequest: InviteUserRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const { project } = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.InviteProjectUser);

    const targetUser = await this.userRepo.findOne({
      where: { email: normalizeEmail(inviteUserRequest.email) },
    });

    // A project invite to someone outside the organization brings them into it: only its owner and admins may do that
    await this.auth.authorizeAddingToOrganization(user, project.organization, targetUser?.id);

    // Anyone can create an account with any email, so only an account that proved it reads this email joins directly.
    // Any other account gets an invite like a new user, accepted with the link sent to the email.
    if (targetUser && !targetUser.emailVerified) {
      const membership = await this.projectUserRepo.findOne({ where: { project: { id: projectId }, user: { id: targetUser.id } } });
      if (membership) {
        throw new ConflictException('this user is already part of the project');
      }
    }

    if (targetUser?.emailVerified) {
      // The person joins the project's organization first (as a member, unless they are one), in the same transaction:
      // a project membership alone gives no access outside the organization (DESIGN §4.3)
      let newProjectUser = await readCommittedTransaction(this.projectUserRepo.manager, async tx => {
        // Decided again under the organization lock that a removal takes: a member removed meanwhile is someone new
        // The locked row, not the copy read before the transaction: an organization closed meanwhile is refused
        const locked = await lockOrganization(tx, project.organizationId);
        if (!locked) {
          throw new NotFoundException('project not found');
        }
        await this.auth.authorizeAddingToOrganization(user, locked, targetUser.id, tx);
        // Someone new to the organization takes one of its seats (402 plan_limit_reached when none is left)
        await assertSeatAvailable(tx, locked, { email: targetUser.email, userId: targetUser.id }, 'member');
        await ensureMember(tx, project.organizationId, targetUser.id);
        return tx.save(
          tx.create(ProjectUser, {
            project: { id: projectId },
            user: targetUser,
            role: inviteUserRequest.role,
          }),
        );
      });

      newProjectUser = await this.projectUserRepo.findOneOrFail({
        where: { id: newProjectUser.id },
        relations: ['user', 'project'],
      });

      this.mail.invitedToProject(newProjectUser);

      // An invite sent before they had an account is no longer needed
      const staleInvite = await this.inviteRepo.findOne({
        where: { project: { id: projectId }, email: normalizeEmail(inviteUserRequest.email) },
      });
      if (staleInvite) {
        await this.inviteRepo.remove(staleInvite);
      }

      return {
        data: {
          userId: newProjectUser.user.id,
          role: newProjectUser.role,
          name: newProjectUser.user.name,
          email: newProjectUser.user.email,
        },
      };
    } else {
      const email = normalizeEmail(inviteUserRequest.email);
      const token = generateInviteToken();

      const newInvite = await readCommittedTransaction(this.inviteRepo.manager, async tx => {
        // Under the organization lock: a pending invitation to someone outside the organization takes one of its seats
        // (OD-T10), counted one change at a time (402 plan_limit_reached when none is left)
        const locked = await lockOrganization(tx, project.organizationId);
        if (!locked) {
          throw new NotFoundException('project not found');
        }
        await assertSeatAvailable(tx, locked, { email, userId: targetUser?.id }, 'invite');

        // Inviting the same email again sends a new link and invalidates the previous one
        const existingInvite = await tx.findOne(Invite, { where: { project: { id: projectId }, email } });
        const record = existingInvite ?? tx.create(Invite, { email, project: { id: projectId } });
        record.role = inviteUserRequest.role;
        record.status = InviteStatus.Sent;
        record.tokenHash = hashInviteToken(token);
        const saved = await tx.save(record, { reload: true });
        await recountSeats(tx, project.organizationId);
        return saved;
      });
      const inviteUrl = inviteSignupUrl(token);

      // Not awaited: the admin also gets the link, and MailService logs delivery failures
      void this.mail.invitedToPlatform({ ...newInvite, project }, inviteUrl);

      return {
        data: {
          id: newInvite.id,
          role: newInvite.role,
          email: newInvite.email,
          status: newInvite.status,
          inviteUrl,
        },
      };
    }
  }

  @Access('project:EditProjectInvites')
  @Patch(':projectId/invites/:inviteId')
  @ApiOperation({ summary: `Update a project invite's role` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: ProjectInviteResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request params or attempting to edit own role' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('inviteId') inviteId: string,
    @Body() updateProjectInviteRequest: UpdateProjectInviteRequest,
  ) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.EditProjectInvites);

    const targetInvite = await this.inviteRepo.findOneOrFail({
      where: { project: { id: projectId }, id: inviteId },
    });

    // Persist only the role: saving the loaded invite would write back a link or status changed in the meantime
    await this.inviteRepo.update({ id: targetInvite.id }, { role: updateProjectInviteRequest.role });
    const updated = await this.inviteRepo.findOneByOrFail({ id: targetInvite.id });

    return {
      data: {
        id: updated.id,
        role: updated.role,
        email: updated.email,
        status: updated.status,
      },
    };
  }

  @Access('project:DeleteProjectInvites')
  @Delete(':projectId/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: `Remove a project invite` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: `Bad request, can't edit your own role` })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('inviteId') inviteId: string) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const { project } = await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.DeleteProjectInvites);

    const targetInvite = await this.inviteRepo.findOneOrFail({
      where: { project: { id: projectId }, id: inviteId },
    });

    // The seat a pending invitation held is free again
    await readCommittedTransaction(this.inviteRepo.manager, async tx => {
      await lockOrganization(tx, project.organizationId);
      await tx.remove(targetInvite);
      await recountSeats(tx, project.organizationId);
    });
  }
}
