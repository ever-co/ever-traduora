import { Controller, Get, Param, Req, HttpStatus } from '@nestjs/common';
import { ProjectAction } from '../domain/actions';
import AuthorizationService from '../services/authorization.service';
import { ApiOAuth2, ApiTags, ApiResponse, ApiOperation } from '@nestjs/swagger';
import { ProjectPlanResponse } from '../domain/http';
import { Access } from '../access/access.decorator';

@Controller('api/v1/projects')
@ApiOAuth2([])
@ApiTags('Project Plans')
export default class ProjectPlanController {
  constructor(private auth: AuthorizationService) {}

  @Access('project:ViewProjectPlan')
  @Get(':projectId/plan')
  @ApiOperation({ summary: `Get a project's plan` })
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
