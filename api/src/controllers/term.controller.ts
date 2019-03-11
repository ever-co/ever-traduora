import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProjectAction } from '../domain/actions';
import { AddTermRequest, UpdateTermRequest } from '../domain/http';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import AuthorizationService from '../services/authorization.service';

@Controller('api/v1/projects/:projectId/terms')
@UseGuards(AuthGuard())
export default class TermController {
  constructor(
    private auth: AuthorizationService,
    @InjectRepository(Term) private termRepo: Repository<Term>,
    @InjectRepository(Project) private projectRepo: Repository<Project>,
  ) {}

  @Get()
  async find(@Req() req, @Param('projectId') projectId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.ViewTerm);
    const terms = await this.termRepo.find({
      where: { project: { id: membership.project.id } },
    });
    return {
      data: terms.map(t => ({
        id: t.id,
        value: t.value,
        date: t.date,
      })),
    };
  }

  @Post()
  async create(@Req() req, @Param('projectId') projectId: string, @Body() payload: AddTermRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.AddTerm, 1);

    const term = this.termRepo.create({
      value: payload.value,
      project: membership.project,
    });

    await this.termRepo.manager.transaction(async entityManager => {
      await entityManager.save(term);
      await entityManager.increment(Project, { id: membership.project.id }, 'termsCount', 1);
    });

    return {
      data: {
        id: term.id,
        value: term.value,
        date: term.date,
      },
    };
  }

  @Patch(':termId')
  async update(@Req() req, @Param('projectId') projectId: string, @Param('termId') termId: string, @Body() payload: UpdateTermRequest) {
    const user = this.auth.getRequestUserOrClient(req);
    await this.auth.authorizeProjectAction(user, projectId, ProjectAction.EditTerm);

    // Ensure is project term
    await this.termRepo.findOneOrFail({ where: { id: termId, project: { id: projectId } } });

    await this.termRepo.update({ id: termId }, { value: payload.value });

    const term = await this.termRepo.findOneOrFail({ id: termId });

    return {
      data: {
        id: term.id,
        value: term.value,
        date: term.date,
      },
    };
  }

  @Delete(':termId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Req() req, @Param('projectId') projectId: string, @Param('termId') termId: string) {
    const user = this.auth.getRequestUserOrClient(req);
    const membership = await this.auth.authorizeProjectAction(user, projectId, ProjectAction.DeleteTerm);
    await this.termRepo.manager.transaction(async entityManager => {
      const term = await entityManager.findOneOrFail(Term, termId);
      await entityManager.remove(term);
      await entityManager.decrement(Project, { id: membership.project.id }, 'termsCount', 1);
    });
  }
}
