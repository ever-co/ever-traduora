import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectClient } from '../entity/project-client.entity';
import { User } from '../entity/user.entity';
import TranslationController, { DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT, parseHistoryLimit } from './translation.controller';

describe('parseHistoryLimit', () => {
  it('uses the default when absent or not a whole number', () => {
    for (const raw of [undefined, null, '', 'abc', '1.5', '-3', '1e3', ['5'], {}]) {
      expect(parseHistoryLimit(raw)).toBe(DEFAULT_HISTORY_LIMIT);
    }
  });

  it('keeps values inside the bounds', () => {
    expect(parseHistoryLimit('1')).toBe(1);
    expect(parseHistoryLimit('20')).toBe(20);
    expect(parseHistoryLimit(String(MAX_HISTORY_LIMIT))).toBe(MAX_HISTORY_LIMIT);
  });

  it('clamps values outside the bounds', () => {
    expect(parseHistoryLimit('0')).toBe(1);
    expect(parseHistoryLimit('101')).toBe(MAX_HISTORY_LIMIT);
    expect(parseHistoryLimit('99999999999999999999999')).toBe(DEFAULT_HISTORY_LIMIT);
  });
});

describe('TranslationController translation history', () => {
  const user = Object.assign(new User(), { id: 'user-1', name: 'Ada' });
  const client = Object.assign(new ProjectClient(), { id: 'client-1' });

  function setup(existing: { value: string } | null) {
    const translationRepo = {
      findOne: jest.fn().mockResolvedValue(existing),
      create: jest.fn((entity: any) => ({ ...entity })),
      save: jest.fn().mockResolvedValue(undefined),
    };
    const projectLocaleRepo = { findOneOrFail: jest.fn().mockResolvedValue({ id: 'locale-1' }), findOne: jest.fn().mockResolvedValue({ id: 'locale-1' }) };
    const termRepo = { findOneOrFail: jest.fn().mockResolvedValue({ id: 'term-1', labels: [] }) };
    const historyRepo = {
      create: jest.fn((entity: any) => entity),
      save: jest.fn().mockResolvedValue(undefined),
      find: jest.fn().mockResolvedValue([]),
    };
    const auth = {
      getRequestUserOrClient: jest.fn(req => req.user),
      authorizeProjectAction: jest.fn().mockResolvedValue({ project: { id: 'project-1' } }),
    };
    const controller = new TranslationController(
      auth as any,
      translationRepo as any,
      projectLocaleRepo as any,
      termRepo as any,
      null as any,
      null as any,
      historyRepo as any,
    );
    return { controller, historyRepo, projectLocaleRepo };
  }

  describe('update', () => {
    it('records the previous value, the new value and the user', async () => {
      const { controller, historyRepo } = setup({ value: 'Hallo' });

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'Hallo Welt' });

      expect(historyRepo.save).toHaveBeenCalledTimes(1);
      expect(historyRepo.save).toHaveBeenCalledWith({
        termId: 'term-1',
        projectLocaleId: 'locale-1',
        previousValue: 'Hallo',
        value: 'Hallo Welt',
        user,
      });
    });

    it('records an empty previous value for a first translation', async () => {
      const { controller, historyRepo } = setup(null);

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'Hallo' });

      expect(historyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ previousValue: '', value: 'Hallo' }));
    });

    it('records no user for a change made with an API client', async () => {
      const { controller, historyRepo } = setup({ value: 'a' });

      await controller.update({ user: client }, 'project-1', 'de', { termId: 'term-1', value: 'b' });

      expect(historyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ user: null }));
    });

    it('records nothing when the value did not change', async () => {
      const { controller, historyRepo } = setup({ value: 'same' });

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'same' });

      expect(historyRepo.save).not.toHaveBeenCalled();
    });

    it('still saves the translation when the history cannot be written', async () => {
      const { controller, historyRepo } = setup({ value: 'a' });
      historyRepo.save.mockRejectedValue(new Error('no such table'));

      const result = await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'b' });

      expect(result.data.value).toBe('b');
    });
  });

  describe('history', () => {
    it('returns the entries with the name of the user and no email', async () => {
      const { controller, historyRepo } = setup(null);
      const created = new Date('2026-01-02T03:04:05Z');
      historyRepo.find.mockResolvedValue([
        { id: 'h1', termId: 'term-1', previousValue: 'a', value: 'b', user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' }, date: { created } },
        { id: 'h2', termId: 'term-1', previousValue: '', value: 'a', user: null, date: { created } },
      ]);

      const result = await controller.history({ user }, 'project-1', 'de', 'term-1');

      expect(result.data).toEqual([
        { id: 'h1', termId: 'term-1', previousValue: 'a', value: 'b', user: { id: 'user-1', name: 'Ada' }, date: created },
        { id: 'h2', termId: 'term-1', previousValue: '', value: 'a', user: undefined, date: created },
      ]);
    });

    it('looks up the entries of the locale and bounds the number returned', async () => {
      const { controller, historyRepo } = setup(null);

      await controller.history({ user }, 'project-1', 'de', 'term-1', '100000');

      expect(historyRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { termId: 'term-1', projectLocaleId: 'locale-1' },
          take: MAX_HISTORY_LIMIT,
        }),
      );
    });

    it('requires a term', async () => {
      const { controller } = setup(null);

      await expect(controller.history({ user }, 'project-1', 'de', '')).rejects.toBeInstanceOf(BadRequestException);
      await expect(controller.history({ user }, 'project-1', 'de', undefined as any)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('is not found for a locale the project does not have', async () => {
      const { controller, projectLocaleRepo } = setup(null);
      projectLocaleRepo.findOne.mockResolvedValue(null);

      await expect(controller.history({ user }, 'project-1', 'xx', 'term-1')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
