import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import * as passwordGenerator from 'generate-password';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { AddProjectClientRequest, UpdateProjectClientRequest } from '../domain/http';
import { ProjectClient } from '../entity/project-client.entity';
import { User } from '../entity/user.entity';
import AuthorizationService from '../services/authorization.service';

@Controller('api/v1/projects')
@UseGuards(AuthGuard())
export default class ProjectClientController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(ProjectClient) private projectClientRepo: Repository<ProjectClient>,
    @InjectRepository(User) private userRepo: Repository<User>,
  ) {}

  @Get(':projectId/clients')
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewProjectClients);

    const clients = await this.projectClientRepo.find({
      where: { project: { id: projectId } },
    });

    return {
      data: clients.map(client => ({
        id: client.id,
        name: client.name,
        role: client.role,
      })),
    };
  }

  @Post(':projectId/clients')
  @HttpCode(HttpStatus.CREATED)
  async create(@Req() req, @Param('projectId') projectId: string, @Body() addProjectClientRequest: AddProjectClientRequest) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.AddProjectClient);

    const { secret, encryptedSecret } = await this.generateSecret();

    let client = this.projectClientRepo.create({
      project: { id: projectId },
      name: addProjectClientRequest.name,
      role: addProjectClientRequest.role,
      encryptedSecret: encryptedSecret,
    });

    client = await this.projectClientRepo.save(client, { reload: true });

    return {
      data: {
        id: client.id,
        name: client.name,
        role: client.role,
        secret: secret,
      },
    };
  }

  @Patch(':projectId/clients/:clientId')
  async update(
    @Req() req,
    @Param('projectId') projectId: string,
    @Param('clientId') clientId: string,
    @Body() updateProjectClientRequest: UpdateProjectClientRequest,
  ) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.EditProjectClients);

    const client = await this.projectClientRepo.findOneOrFail({
      where: { project: { id: projectId }, id: clientId },
    });

    client.role = updateProjectClientRequest.role;

    const updated = await this.projectClientRepo.save(client, { reload: true });

    return {
      data: {
        id: updated.id,
        name: updated.name,
        role: updated.role,
      },
    };
  }

  @Post(':projectId/clients/:clientId/rotate-secret')
  async rotate(@Req() req, @Param('projectId') projectId: string, @Param('clientId') clientId: string) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.EditProjectClients);

    const client = await this.projectClientRepo.findOneOrFail({
      where: { project: { id: projectId }, id: clientId },
    });

    const { secret, encryptedSecret } = await this.generateSecret();

    client.encryptedSecret = encryptedSecret;

    const updated = await this.projectClientRepo.save(client, { reload: true });

    return {
      data: {
        id: updated.id,
        name: updated.name,
        role: updated.role,
        secret: secret,
      },
    };
  }

  @Delete(':projectId/clients/:clientId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('clientId') clientId: string) {
    const requestingUser = this.auth.getRequestUserOrClient(req, { mustBeUser: true });
    await this.auth.authorizeProjectAction(requestingUser, projectId, ProjectAction.DeleteProjectClients);

    const client = await this.projectClientRepo.findOneOrFail({
      where: { project: { id: projectId }, id: clientId },
    });

    await this.projectClientRepo.remove(client);
  }

  private async generateSecret() {
    const secret = passwordGenerator.generate({
      length: 32,
      numbers: true,
      symbols: false,
      uppercase: true,
      strict: true,
    });
    const encryptedSecret = Buffer.from(await bcrypt.hash(secret, 10), 'utf-8');

    return {
      secret,
      encryptedSecret,
    };
  }
}
