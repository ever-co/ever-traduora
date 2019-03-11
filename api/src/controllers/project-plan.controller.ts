import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProjectAction } from '../domain/actions';
import AuthorizationService from '../services/authorization.service';

@Controller('api/v1/projects')
@UseGuards(AuthGuard())
export default class ProjectPlanController {
  constructor(private auth: AuthorizationService) {}

  @Get(':projectId/plan')
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewProjectPlan);
    return {
      data: membership.project.plan,
    };
  }
}
