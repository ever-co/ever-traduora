import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectAction } from '../domain/actions';
import { User } from '../entity/user.entity';
import ProjectActivityController from './project-activity.controller';
import { MAX_HISTORY_LIMIT } from './translation.controller';

describe('ProjectActivityController', () => {
  const user = Object.assign(new User(), { id: 'user-1', name: 'Ada' });
  const date = new Date('2024-05-01T10:00:00Z');

  const projectLocales = [
    { id: 'pl-de', locale: { code: 'de' } },
    { id: 'pl-fr', locale: { code: 'fr' } },
  ];

  function setup(entries: any[] = [], locales: any[] = projectLocales) {
    const auth = {
      getRequestUserOrClient: jest.fn(req => req.user),
      authorizeProjectAction: jest.fn().mockResolvedValue({ project: { id: 'project-1' } }),
    };
    const projectLocaleRepo = { find: jest.fn().mockResolvedValue(locales) };
    const termRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'term-1', value: 'hello' },
        { id: 'term-2', value: 'bye' },
      ]),
    };
    const historyRepo = { find: jest.fn().mockResolvedValue(entries) };
    const controller = new ProjectActivityController(auth as any, projectLocaleRepo as any, termRepo as any, historyRepo as any);
    return { controller, auth, projectLocaleRepo, termRepo, historyRepo };
  }

  const entry = (over: any = {}) => ({
    id: 'h-1',
    termId: 'term-1',
    projectLocaleId: 'pl-de',
    revision: 2,
    previousValue: 'Hallo',
    value: 'Hallo Welt',
    user,
    date: { created: date },
    ...over,
  });

  it('lists the changes of the project with the term and the locale code, newest first', async () => {
    const { controller, auth, historyRepo } = setup([
      entry(),
      entry({ id: 'h-2', termId: 'term-2', projectLocaleId: 'pl-fr', revision: 1, previousValue: '', value: 'Au revoir', user: null }),
    ]);

    const result = await controller.find({ user }, 'project-1');

    expect(auth.authorizeProjectAction).toHaveBeenCalledWith(user, 'project-1', ProjectAction.ViewTranslation);
    expect(historyRepo.find).toHaveBeenCalledWith(expect.objectContaining({ order: { date: { created: 'DESC' }, revision: 'DESC' }, take: 50 }));
    expect(result.data).toEqual([
      {
        id: 'h-1',
        termId: 'term-1',
        term: 'hello',
        locale: 'de',
        revision: 2,
        previousValue: 'Hallo',
        value: 'Hallo Welt',
        user: { id: 'user-1', name: 'Ada' },
        date,
      },
      {
        id: 'h-2',
        termId: 'term-2',
        term: 'bye',
        locale: 'fr',
        revision: 1,
        previousValue: '',
        value: 'Au revoir',
        user: undefined,
        date,
      },
    ]);
  });

  it('reads the history of the locales of this project only', async () => {
    const { controller, historyRepo, projectLocaleRepo, termRepo } = setup([entry()]);

    await controller.find({ user }, 'project-1');

    expect(projectLocaleRepo.find).toHaveBeenCalledWith(expect.objectContaining({ where: { project: { id: 'project-1' } } }));
    const where = historyRepo.find.mock.calls[0][0].where;
    expect(where.projectLocaleId.value).toEqual(['pl-de', 'pl-fr']);
    // Terms are looked up within the project as well
    expect(termRepo.find.mock.calls[0][0].where.project).toEqual({ id: 'project-1' });
  });

  it('narrows to one locale', async () => {
    const { controller, historyRepo } = setup([entry()]);

    await controller.find({ user }, 'project-1', undefined, 'fr');

    expect(historyRepo.find.mock.calls[0][0].where.projectLocaleId.value).toEqual(['pl-fr']);
  });

  it('answers not found for a locale the project does not have', async () => {
    const { controller, historyRepo } = setup([entry()]);

    await expect(controller.find({ user }, 'project-1', undefined, 'xx')).rejects.toBeInstanceOf(NotFoundException);
    expect(historyRepo.find).not.toHaveBeenCalled();
  });

  // The extended query parser gives ?locale=fr&locale=de and ?locale[]=fr as an array, ?locale[x]=fr as an object
  it('answers bad request for a locale given as an array, without reading history', async () => {
    const { controller, projectLocaleRepo, historyRepo } = setup([entry()]);

    await expect(controller.find({ user }, 'project-1', undefined, ['fr', 'de'] as any)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.find({ user }, 'project-1', undefined, ['fr'] as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(projectLocaleRepo.find).not.toHaveBeenCalled();
    expect(historyRepo.find).not.toHaveBeenCalled();
  });

  it('answers bad request for a locale given as an object, without reading history', async () => {
    const { controller, projectLocaleRepo, historyRepo } = setup([entry()]);

    await expect(controller.find({ user }, 'project-1', undefined, { x: 'fr' } as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(projectLocaleRepo.find).not.toHaveBeenCalled();
    expect(historyRepo.find).not.toHaveBeenCalled();
  });

  it('lists every locale for an empty locale', async () => {
    const { controller, historyRepo } = setup([entry()]);

    await controller.find({ user }, 'project-1', undefined, '');

    expect(historyRepo.find.mock.calls[0][0].where.projectLocaleId.value).toEqual(['pl-de', 'pl-fr']);
  });

  it('bounds the limit', async () => {
    const { controller, historyRepo } = setup([entry()]);

    await controller.find({ user }, 'project-1', '100000');
    await controller.find({ user }, 'project-1', '0');
    await controller.find({ user }, 'project-1', 'abc');
    await controller.find({ user }, 'project-1', '7');

    expect(historyRepo.find.mock.calls.map(call => call[0].take)).toEqual([MAX_HISTORY_LIMIT, 1, 50, 7]);
  });

  it('is empty without reading history when the project has no locale or no change', async () => {
    const none = setup([], []);
    expect((await none.controller.find({ user }, 'project-1')).data).toEqual([]);
    expect(none.historyRepo.find).not.toHaveBeenCalled();

    const quiet = setup([]);
    expect((await quiet.controller.find({ user }, 'project-1')).data).toEqual([]);
    expect(quiet.termRepo.find).not.toHaveBeenCalled();
  });

  it('does not read anything when the user may not view the project', async () => {
    const { controller, auth, projectLocaleRepo } = setup([entry()]);
    auth.authorizeProjectAction.mockRejectedValue(new NotFoundException());

    await expect(controller.find({ user }, 'project-1')).rejects.toBeInstanceOf(NotFoundException);
    expect(projectLocaleRepo.find).not.toHaveBeenCalled();
  });
});
