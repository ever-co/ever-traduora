import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiResponse } from '@nestjs/swagger';
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
import MailService from '../services/mail.service';

@Controller('api/v1/projects')
@UseGuards(AuthGuard())
export default class ProjectInviteController {
  constructor(
    private auth: AuthorizationService,
    private mail: MailService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Invite) private inviteRepo: Repository<Invite>,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
  ) {}

  @Get(':projectId/invites')
  @ApiOperation({ title: 'List all invites with access to a project' })
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

  @Post(':projectId/invites')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ title: 'Add a new project invite' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectInviteCreatedResponse })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Project not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Param('projectId') projectId: string, @Body() inviteUserRequest: InviteUserRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const { project } = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.InviteProjectUser);

    const targetUser = await this.userRepo.findOne({
      where: { email: normalizeEmail(inviteUserRequest.email) },
    });

    if (targetUser) {
      const record = this.projectUserRepo.create({
        project: { id: projectId },
        user: targetUser,
        role: inviteUserRequest.role,
      });

      let newProjectUser = await this.projectUserRepo.save(record);

      newProjectUser = await this.projectUserRepo.findOneOrFail({
        where: { id: newProjectUser.id },
        relations: ['user', 'project'],
      });

      this.mail.invitedToProject(newProjectUser);

      return {
        data: {
          userId: newProjectUser.user.id,
          role: newProjectUser.role,
          name: newProjectUser.user.name,
          email: newProjectUser.user.email,
        },
      };
    } else {
      const record = this.inviteRepo.create({
        email: normalizeEmail(inviteUserRequest.email),
        project: { id: projectId },
        role: inviteUserRequest.role,
      });

      const newInvite = await this.inviteRepo.save(record, { reload: true });

      this.mail.invitedToPlatform({ ...record, project });

      return {
        data: {
          id: newInvite.id,
          role: newInvite.role,
          email: newInvite.email,
          status: newInvite.status,
        },
      };
    }
  }

  @Patch(':projectId/invites/:inviteId')
  @ApiOperation({ title: `Update a project invite's role` })
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
      where: { id: inviteId },
      relations: ['project'],
    });

    targetInvite.role = updateProjectInviteRequest.role;

    const updated = await this.inviteRepo.save(targetInvite, { reload: true });

    return {
      data: {
        id: updated.id,
        role: updated.role,
        email: updated.email,
        status: updated.status,
      },
    };
  }

  @Delete(':projectId/invites/:inviteId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ title: `Remove a project invite` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: `Bad request, can't edit your own role` })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('inviteId') inviteId: string) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.DeleteProjectInvites);

    const targetInvite = await this.inviteRepo.findOneOrFail({
      where: { id: inviteId },
    });

    await this.inviteRepo.remove(targetInvite);
  }
}
