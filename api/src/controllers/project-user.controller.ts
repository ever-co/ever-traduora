import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { AddProjectUserRequest, UpdateProjectUserRequest, ListProjectUsersResponse, ProjectUserResponse } from '../domain/http';
import { ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import AuthorizationService from '../services/authorization.service';
import MailService from '../services/mail.service';
import { ApiBearerAuth, ApiUseTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@Controller('api/v1/projects')
@UseGuards(AuthGuard())
@ApiBearerAuth()
@ApiUseTags('Project Users')
export default class ProjectUserController {
  constructor(
    private auth: AuthorizationService,
    private mail: MailService,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  @Get(':projectId/users')
  @ApiOperation({ title: 'List all users with access to a project' })
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

  @Post(':projectId/users')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ title: 'Grant access to a project to an existing user' })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Created', type: ProjectUserResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async create(@Req() req, @Param('projectId') projectId: string, @Body() addProjectUserRequest: AddProjectUserRequest) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.AddProjectUser);

    const targetUser = await this.userRepo.findOneOrFail({
      where: { email: addProjectUserRequest.email },
    });

    const record = this.projectUserRepo.create({
      project: { id: projectId },
      user: targetUser,
      role: addProjectUserRequest.role,
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
  }

  @Patch(':projectId/users/:userId')
  @ApiOperation({ title: `Update a project user's role` })
  @ApiResponse({ status: HttpStatus.OK, description: 'Updated', type: ProjectUserResponse })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Bad request params or attempting to edit own role' })
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

    const targetUser = await this.projectUserRepo.findOneOrFail({
      where: { user: { id: userId }, project: { id: projectId } },
      relations: ['user', 'project'],
    });

    targetUser.role = updateProjectUserRequest.role;

    const updated = await this.projectUserRepo.save(targetUser, { reload: true });

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
  @ApiOperation({ title: `Revoke a user's access to a project` })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Deleted' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Not found' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: `Bad request, can't edit your own role` })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('userId') userId: string) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.DeleteProjectUsers);

    // Prevent the current user from removing himself
    if (requestingUser.id === userId) {
      throw new BadRequestException(`can't edit your own role`);
    }

    const targetUser = await this.projectUserRepo.findOneOrFail({
      where: { user: { id: userId } },
    });

    await this.projectUserRepo.remove(targetUser);
  }
}
