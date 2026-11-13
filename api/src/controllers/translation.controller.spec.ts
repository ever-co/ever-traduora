import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
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

  function setup(initial: string | null) {
    // A stored translation whose value is replaced only when the update's condition on the old value holds
    const stored: { value: string } | null = initial === null ? null : { value: initial };
    const translationRepo = {
      findOne: jest.fn(async () => (stored ? { ...stored } : null)),
      create: jest.fn((entity: any) => ({ ...entity })),
      save: jest.fn().mockResolvedValue(undefined),
      update: jest.fn(async (criteria: any, changes: any) => {
        if (stored && stored.value === criteria.value) {
          stored.value = changes.value;
          return { affected: 1 };
        }
        return { affected: 0 };
      }),
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
    return { controller, historyRepo, projectLocaleRepo, translationRepo, stored };
  }

  describe('update', () => {
    it('records the previous value, the new value and the user', async () => {
      const { controller, historyRepo } = setup('Hallo');

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'Hallo Welt' });

      expect(historyRepo.save).toHaveBeenCalledTimes(1);
      expect(historyRepo.save).toHaveBeenCalledWith({
        termId: 'term-1',
        projectLocaleId: 'locale-1',
        previousValue: 'Hallo',
        value: 'Hallo Welt',
        user,
        date: { created: expect.any(Date) },
      });
    });

    it('records an empty previous value for a first translation', async () => {
      const { controller, historyRepo } = setup(null);

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'Hallo' });

      expect(historyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ previousValue: '', value: 'Hallo' }));
    });

    it('records no user for a change made with an API client', async () => {
      const { controller, historyRepo } = setup('a');

      await controller.update({ user: client }, 'project-1', 'de', { termId: 'term-1', value: 'b' });

      expect(historyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ user: null }));
    });

    it('records nothing when the value did not change', async () => {
      const { controller, historyRepo, translationRepo } = setup('same');

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'same' });

      expect(historyRepo.save).not.toHaveBeenCalled();
      expect(translationRepo.update).not.toHaveBeenCalled();
    });

    it('still saves the translation when the history cannot be written', async () => {
      const { controller, historyRepo } = setup('a');
      historyRepo.save.mockRejectedValue(new Error('no such table'));

      const result = await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'b' });

      expect(result.data.value).toBe('b');
    });

    it('records the value that was really replaced when another edit lands between the read and the write', async () => {
      const { controller, historyRepo, translationRepo, stored } = setup('x');
      // The first read sees 'x', then another edit makes it 'y' before this one writes
      translationRepo.findOne.mockImplementationOnce(async () => {
        const seen = { ...stored! };
        stored!.value = 'y';
        return seen;
      });

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'z' });

      expect(stored!.value).toBe('z');
      expect(historyRepo.save).toHaveBeenCalledTimes(1);
      expect(historyRepo.save).toHaveBeenCalledWith(expect.objectContaining({ previousValue: 'y', value: 'z' }));
    });

    it('answers with a conflict when the value keeps changing underneath the edit', async () => {
      const { controller, historyRepo, translationRepo } = setup('x');
      translationRepo.update.mockResolvedValue({ affected: 0 });

      await expect(controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'z' })).rejects.toBeInstanceOf(ConflictException);
      expect(historyRepo.save).not.toHaveBeenCalled();
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
