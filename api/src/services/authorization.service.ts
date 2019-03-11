import { ForbiddenException, Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AllowedEditorActions, AllowedViewerActions, ProjectAction } from '../domain/actions';
import { ProjectClient } from '../entity/project-client.entity';
import { ProjectRole, ProjectUser } from '../entity/project-user.entity';
import { User } from '../entity/user.entity';
import { PaymentRequiredException } from '../errors';

@Injectable()
export default class AuthorizationService {
  constructor(
    @InjectRepository(ProjectClient) private projectClientRepo: Repository<ProjectClient>,
    @InjectRepository(ProjectUser) private projectUserRepo: Repository<ProjectUser>,
  ) {}

  getRequestUserOrClient(req): User | ProjectClient;
  getRequestUserOrClient(req, options: { mustBeUser: true }): User;
  getRequestUserOrClient(req, options: { mustBeUser: boolean } = { mustBeUser: false }): User | ProjectClient {
    const user = req.user as User | ProjectClient;
    if (!user) {
      throw new InternalServerErrorException('user not set in request context');
    }
    if (options.mustBeUser && !(user instanceof User)) {
      throw new UnauthorizedException('only users are allowed to perform this action');
    }
    return user;
  }

  async mustBeProjectUserOrClient(userOrClient: User | ProjectClient, projectId: string): Promise<ProjectUser | ProjectClient> {
    if (userOrClient instanceof User) {
      const membership = await this.projectUserRepo.findOne({
        where: { project: { id: projectId }, user: { id: userOrClient.id } },
        relations: ['project', 'project.plan'],
      });
      if (!membership) {
        throw new ForbiddenException('project not found');
      }
      return membership;
    } else if (userOrClient instanceof ProjectClient) {
      const membership = await this.projectClientRepo.findOne({
        where: { project: { id: projectId }, id: userOrClient.id },
        relations: ['project', 'project.plan'],
      });
      if (!membership) {
        throw new ForbiddenException('project not found');
      }
      return membership;
    } else {
      throw new ForbiddenException('unknown entity claims to be project client or user');
    }
  }

  async authorizeProjectAction(
    userOrClient: User | ProjectClient,
    projectId: string,
    action: ProjectAction,
    newTermsCount: number = 0,
    newLocalesCount: number = 0,
  ): Promise<ProjectUser | ProjectClient> {
    const membership = await this.mustBeProjectUserOrClient(userOrClient, projectId);
    if (!this.isAuthorized(membership.role, action)) {
      throw new ForbiddenException('you are not authorized to perform this action');
    }
    const localesCount = membership.project.localesCount + newLocalesCount;
    const termsCount = membership.project.termsCount + newTermsCount;
    switch (action) {
      case ProjectAction.AddTerm:
      case ProjectAction.AddTranslation:
      case ProjectAction.ImportTranslation:
        if (localesCount * termsCount > membership.project.plan.maxStrings) {
          throw new PaymentRequiredException('request would exceed plan limit');
        }
    }
    return membership;
  }

  private isAuthorized(role: ProjectRole, action: ProjectAction): boolean {
    switch (role) {
      // Authorize admins to every action
      case ProjectRole.Admin:
        return true;
      case ProjectRole.Editor:
        return AllowedEditorActions.has(action);
      case ProjectRole.Viewer:
        return AllowedViewerActions.has(action);
      default:
        return false;
    }
  }
}
