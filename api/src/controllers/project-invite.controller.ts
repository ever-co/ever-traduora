import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { normalizeEmail } from 'domain/validators';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { InviteUserRequest, UpdateProjectInviteRequest } from '../domain/http';
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
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewProjectInvites);

    const invites = await this.inviteRepo.find({
      where: { project: { id: projectId }, status: InviteStatus.Sent },
    });

    return {
      data: invites,
    };
  }

  @Post(':projectId/invites')
  async create(@Req() req, @Param('projectId') projectId: string, @Body() inviteUserRequest: InviteUserRequest) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.InviteProjectUser);

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

      this.mail.invitedToPlatform(record);

      return {
        data: {
          id: newInvite.id,
          role: newInvite.role,
          email: newInvite.email,
        },
      };
    }
  }

  @Patch(':projectId/invites/:inviteId')
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
      },
    };
  }

  @Delete(':projectId/invites/:inviteId')
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('inviteId') inviteId: string) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.DeleteProjectInvites);

    const targetInvite = await this.inviteRepo.findOneOrFail({
      where: { id: inviteId },
    });

    await this.inviteRepo.remove(targetInvite);
  }
}
