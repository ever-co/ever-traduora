import { BadRequestException } from '@nestjs/common';
import { ProjectAction } from '../domain/actions';
import TermController from './term.controller';

describe('TermController findByLabel', () => {
  function setup(terms: any[] = []) {
    const auth = {
      getRequestUserOrClient: jest.fn(req => req.user),
      authorizeProjectAction: jest.fn().mockResolvedValue({ project: { id: 'project-1' } }),
    };
    const queryBuilder: any = {
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue(terms),
    };
    const termRepo = { createQueryBuilder: jest.fn().mockReturnValue(queryBuilder) };
    const controller = new TermController(auth as any, termRepo as any, {} as any, {} as any);
    return { controller, auth, termRepo, queryBuilder };
  }

  const req = { user: { id: 'user-1' } };

  it('lists the terms that carry the label', async () => {
    const date = new Date('2024-05-01T10:00:00Z');
    const { controller, auth, queryBuilder } = setup([{ id: 't-1', value: 'hello', context: 'greeting', labels: [{ id: 'l-1' }], date }]);

    const result = await controller.findByLabel(req, 'project-1', 'l-1');

    expect(auth.authorizeProjectAction).toHaveBeenCalledWith(req.user, 'project-1', ProjectAction.ViewTerm);
    expect(queryBuilder.innerJoin).toHaveBeenCalledWith('term.labels', 'filterLabel', 'filterLabel.id = :labelId', { labelId: 'l-1' });
    expect(result).toEqual({ data: [{ id: 't-1', value: 'hello', context: 'greeting', labels: [{ id: 'l-1' }], date }] });
  });

  it.each([[undefined], ['']])('answers an empty list, without a query, when the label is %p', async labelId => {
    const { controller, termRepo } = setup();

    const result = await controller.findByLabel(req, 'project-1', labelId as any);

    expect(result).toEqual({ data: [], message: 'No label provided for filtering' });
    expect(termRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it.each([[['a', 'b']], [['a']], [{ x: 'a' }]])('refuses a repeated or nested label id (%j) with a 400, without a query', async labelId => {
    const { controller, termRepo } = setup();

    await expect(controller.findByLabel(req, 'project-1', labelId as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(termRepo.createQueryBuilder).not.toHaveBeenCalled();
  });
});
