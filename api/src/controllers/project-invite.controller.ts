import { Controller, UseGuards, Get, Req, Param, Inject } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { InjectRepository } from "@nestjs/typeorm";
import { User } from "entity/user.entity";
import AuthorizationService from "services/authorization.service";
import MailService from "services/mail.service";
import { Repository } from "typeorm";
import { ProjectAction } from "domain/actions";
import { Invite } from "entity/invite.entity";

@Controller('api/v1/projects')
@UseGuards(AuthGuard())
export default class ProjectInviteController {
  constructor(
    private auth: AuthorizationService,
    private mail: MailService,
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Invite) private inviteRepo: Repository<Invite>,
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
  }