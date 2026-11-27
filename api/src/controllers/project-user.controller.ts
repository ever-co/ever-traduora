import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiOAuth2, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Not, Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { ListProjectUsersResponse, ProjectUserResponse, UpdateProjectUserRequest } from '../domain/http';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import AuthorizationService from '../services/authorization.service';
import { lockProjects, readCommittedTransaction } from '../utils/database-locks';

/**
 * Refuses a change that takes the admin role from the project's last admin. Run under the project's lock
 * ({@link readCommittedTransaction}): an account deletion at the same time (*Delete account*, or Ever Platform's)
 * counted this admin as the one who stays, or deleted the account that asked for the change.
 */
async function keepAnotherAdmin(manager: EntityManager, membership: ProjectUser, projectId: string): Promise<void> {
  if (membership.role !== ProjectRole.Admin) {
    return;
  }
  const otherAdmins = await manager.getRepository(ProjectUser).count({
    where: { project: { id: projectId }, role: ProjectRole.Admin, id: Not(membership.id) },
  });
  if (!otherAdmins) {
    throw new UnprocessableEntityException(`can't remove the last admin of the project`);
  }
}

@Controller('api/v1/projects')
@UseGuards(AuthGuard())
@ApiOAuth2([])
@ApiTags('Project Users')
export default class ProjectUserController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
  ) {}

  @Get(':projectId/users')
  @ApiOperation({ summary: 'List all users with access to a project' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Success', type: ListProjectUsersResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewProjectUsers);

    const users = await this.projectUserRepo.find({
      where: { project: { id: projectId } },
      relations: ['user'],
    });

    return {
      data: users.map(member => ({
        userId: member.user.id,
        role: member.role,
        name: member.user.name,
        email: member.user.email,
      })),
    };
  }

  @Patch(':projectId/users/:userId')
  @ApiOperation({ summary: `Update a project user's role` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: ProjectUserResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request params or attempting to edit own role' })
  @ApiResponse({ status: HttpStatus.UNPROCESSABLE_ENTITY, description: 'The project would be left without an admin' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async update(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('userId') userId: string,
    @Body() updateProjectUserRequest: UpdateProjectUserRequest,
  ) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.EditProjectUsers);

    // Prevent the current user from editing himself
    if (requestingUser.id === userId) {
      throw new BadRequestException(`can't edit your own role`);
    }

    const updated = await readCommittedTransaction(this.projectUserRepo.manager, async manager => {
      await lockProjects(manager, [projectId]);
      const memberships = manager.getRepository(ProjectUser);
      const targetUser = await memberships.findOneOrFail({
        where: { user: { id: userId }, project: { id: projectId } },
        relations: ['user', 'project'],
      });

      if (updateProjectUserRequest.role !== ProjectRole.Admin) {
        await keepAnotherAdmin(manager, targetUser, projectId);
      }
      targetUser.role = updateProjectUserRequest.role;

      return memberships.save(targetUser, { reload: true });
    });

    return {
      data: {
        userId: updated.user.id,
        role: updated.role,
        name: updated.user.name,
        email: updated.user.email,
      },
    };
  }

  @Delete(':projectId/users/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: `Revoke a user's access to a project` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: `Bad request, can't edit your own role` })
  @ApiResponse({ status: HttpStatus.UNPROCESSABLE_ENTITY, description: 'The project would be left without an admin' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('userId') userId: string) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.DeleteProjectUsers);

    // Prevent the current user from removing himself
    if (requestingUser.id === userId) {
      throw new BadRequestException(`can't edit your own role`);
    }

    await readCommittedTransaction(this.projectUserRepo.manager, async manager => {
      await lockProjects(manager, [projectId]);
      const memberships = manager.getRepository(ProjectUser);
      const targetUser = await memberships.findOne({
        where: {
          user: { id: userId },
          project: { id: projectId },
        },
        relations: ['user', 'project'],
      });

      if (!targetUser) {
        throw new BadRequestException(`The specified user is not part of this project.`);
      }

      await keepAnotherAdmin(manager, targetUser, projectId);
      await memberships.remove(targetUser);
    });
  }
}
