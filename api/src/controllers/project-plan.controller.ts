import { Controller, Get, Param, Req, UseGuards, HttpStatus } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProjectAction } from '../domain/actions';
import AuthorizationService from '../services/authorization.service';
import { ApiBearerAuth, ApiUseTags, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { ProjectPlanResponse } from '../domain/http';

@Controller('api/v1/projects')
@UseGuards(AuthGuard())
@ApiBearerAuth()
@ApiUseTags('Project Plans')
export default class ProjectPlanController {
  constructor(private auth: AuthorizationService) {}

  @Get(':projectId/plan')
  @ApiOperation({ title: "Get a project's plan" })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ProjectPlanResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewProjectPlan);
    return {
      data: membership.project.plan,
    };
  }
}
