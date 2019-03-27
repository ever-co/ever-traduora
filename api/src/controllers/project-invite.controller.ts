import { Controller, UseGuards, Get, Req, Param, Inject, Post, Body, Delete } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "entity/user.entity";
import AuthorizationService from "services/authorization.service";
import MailService from "services/mail.service";
import { Repository } from "typeorm";
import { ProjectAction } from "domain/actions";
import { Invite } from "entity/invite.entity";
import { InviteUserRequest } from "domain/http";
import { ProjectUser } from "entity/project-user.entity";

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
      await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewProjectUsers);
      
      const invites = await this.inviteRepo.find({
        where: { project: { id: projectId }},
      })
      
      return {
        data: invites,
      };
    }

    @Post(':projectId/invites')
    async create(@Req() req, @Param('projectId') projectId: string, @Body() inviteUserRequest: InviteUserRequest) {
      const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
      await this.auth.authorizeProjectAction(user, projectId, ProjectAction.AddProjectUser);

      const targetUser = await this.userRepo.findOne({
        where: { email: inviteUserRequest.email },
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
          email: inviteUserRequest.email,
          project: { id: projectId },
          role: inviteUserRequest.role,
        });

        let newInvite = await this.inviteRepo.save(record, { reload: true });

        this.mail.invitedToPlatform(record);

        return {
          data: {
            inviteId: newInvite.id,
            project: newInvite.role,
            email: newInvite.email,
          }
        }
      }
    }

    @Delete(':projectId/invites/:inviteId')
    async delete(@Req() req, @Param('projectId') projectId: string, @Param('inviteId') inviteId: string) {
      
    }
  }