import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectClient } from '../entity/project-client.entity';
import { TranslationHistory } from '../entity/translation-history.entity';
import { Translation } from '../entity/translation.entity';
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

  // Lets other pending work run, so that edits that are not serialized would interleave in these tests
  const yieldToOthers = () => new Promise(resolve => setImmediate(resolve));

  function setup(initial: string | null) {
    const state = { stored: initial === null ? null : { value: initial }, history: [] as any[] };

    const manager: any = {
      transaction: jest.fn(async (work: (em: any) => Promise<any>) => work(manager)),
      findOne: jest.fn(async (entity: any, options: any) => {
        await yieldToOthers();
        if (entity === Translation) {
          return state.stored ? { ...state.stored } : null;
        }
        expect(entity).toBe(TranslationHistory);
        expect(options.order).toEqual({ revision: 'DESC' });
        return state.history.length ? { ...state.history[state.history.length - 1] } : null;
      }),
      findOneOrFail: jest.fn(async () => {
        await yieldToOthers();
        return { ...state.stored, labels: [] };
      }),
      create: jest.fn((entity: any, data: any) => ({ __entity: entity, ...data })),
      save: jest.fn(async (record: any) => {
        await yieldToOthers();
        if (record.__entity === TranslationHistory) {
          state.history.push(record);
        } else {
          state.stored = { value: record.value };
        }
      }),
      update: jest.fn(async (entity: any, where: any, changes: any) => {
        await yieldToOthers();
        state.stored = { value: changes.value };
      }),
    };

    const translationRepo = { manager };
    const projectLocaleRepo = { findOneOrFail: jest.fn().mockResolvedValue({ id: 'locale-1' }), findOne: jest.fn().mockResolvedValue({ id: 'locale-1' }) };
    const termRepo = { findOneOrFail: jest.fn().mockResolvedValue({ id: 'term-1', labels: [] }) };
    const historyRepo = { find: jest.fn().mockResolvedValue([]) };
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
    return { controller, historyRepo, projectLocaleRepo, termRepo, manager, state };
  }

  describe('update', () => {
    it('records the previous value, the new value, the user and the change number', async () => {
      const { controller, state } = setup('Hallo');

      const result = await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'Hallo Welt' });

      expect(result.data.value).toBe('Hallo Welt');
      expect(state.history).toEqual([
        {
          __entity: TranslationHistory,
          termId: 'term-1',
          projectLocaleId: 'locale-1',
          revision: 1,
          previousValue: 'Hallo',
          value: 'Hallo Welt',
          user,
        },
      ]);
    });

    it('numbers the changes of a translation one after the other', async () => {
      const { controller, state } = setup('a');

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'b' });
      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'c' });

      expect(state.history.map(h => [h.revision, h.previousValue, h.value])).toEqual([
        [1, 'a', 'b'],
        [2, 'b', 'c'],
      ]);
    });

    it('records an empty previous value for a first translation', async () => {
      const { controller, state } = setup(null);

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'Hallo' });

      expect(state.stored).toEqual({ value: 'Hallo' });
      expect(state.history).toEqual([expect.objectContaining({ revision: 1, previousValue: '', value: 'Hallo' })]);
    });

    it('records no user for a change made with an API client', async () => {
      const { controller, state } = setup('a');

      await controller.update({ user: client }, 'project-1', 'de', { termId: 'term-1', value: 'b' });

      expect(state.history).toEqual([expect.objectContaining({ user: null })]);
    });

    it('records nothing and writes nothing when the value did not change', async () => {
      const { controller, state, manager } = setup('same');

      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'same' });

      expect(state.history).toEqual([]);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('keeps overlapping edits in order, each recording the value it really replaced', async () => {
      const { controller, state } = setup('A');

      // One editor saves B while another saves A: whichever goes second must see the other's value as the previous one
      await Promise.all([
        controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'B' }),
        controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'A' }),
      ]);

      expect(state.history.map(h => [h.revision, h.previousValue, h.value])).toEqual([
        [1, 'A', 'B'],
        [2, 'B', 'A'],
      ]);
      expect(state.stored).toEqual({ value: 'A' });
    });

    it('keeps many overlapping edits as an unbroken chain', async () => {
      const { controller, state } = setup('v0');

      await Promise.all([1, 2, 3, 4, 5].map(n => controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: `v${n}` })));

      expect(state.history.map(h => h.revision)).toEqual([1, 2, 3, 4, 5]);
      state.history.forEach((entry, index) => {
        expect(entry.previousValue).toBe(`v${index}`);
        expect(entry.value).toBe(`v${index + 1}`);
      });
    });

    it('fails the edit as a whole when the history cannot be written, and later edits still go through', async () => {
      const { controller, manager, state } = setup('a');
      manager.save.mockImplementationOnce(async () => {
        throw new Error('no such table');
      });

      await expect(controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'b' })).rejects.toThrow('no such table');

      state.stored = { value: 'a' };
      await controller.update({ user }, 'project-1', 'de', { termId: 'term-1', value: 'c' });
      expect(state.stored).toEqual({ value: 'c' });
      expect(state.history).toEqual([expect.objectContaining({ previousValue: 'a', value: 'c' })]);
    });

    it('is not found for an unknown locale or term', async () => {
      const { controller, projectLocaleRepo, termRepo } = setup('a');
      projectLocaleRepo.findOneOrFail.mockRejectedValueOnce(new Error('none'));
      await expect(controller.update({ user }, 'project-1', 'xx', { termId: 'term-1', value: 'b' })).rejects.toThrow('project locale not found');

      termRepo.findOneOrFail.mockRejectedValueOnce(new Error('none'));
      await expect(controller.update({ user }, 'project-1', 'de', { termId: 'nope', value: 'b' })).rejects.toThrow('project term not found');
    });
  });

  describe('history', () => {
    it('returns the entries with the name of the user and no email', async () => {
      const { controller, historyRepo } = setup(null);
      const created = new Date('2026-01-02T03:04:05Z');
      historyRepo.find.mockResolvedValue([
        {
          id: 'h2',
          termId: 'term-1',
          revision: 2,
          previousValue: 'a',
          value: 'b',
          user: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
          date: { created },
        },
        { id: 'h1', termId: 'term-1', revision: 1, previousValue: '', value: 'a', user: null, date: { created } },
      ]);

      const result = await controller.history({ user }, 'project-1', 'de', 'term-1');

      expect(result.data).toEqual([
        { id: 'h2', termId: 'term-1', revision: 2, previousValue: 'a', value: 'b', user: { id: 'user-1', name: 'Ada' }, date: created },
        { id: 'h1', termId: 'term-1', revision: 1, previousValue: '', value: 'a', user: undefined, date: created },
      ]);
    });

    it('orders by change number, newest first, and bounds the number returned', async () => {
      const { controller, historyRepo } = setup(null);

      await controller.history({ user }, 'project-1', 'de', 'term-1', '100000');

      expect(historyRepo.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { termId: 'term-1', projectLocaleId: 'locale-1' },
          order: { revision: 'DESC' },
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
