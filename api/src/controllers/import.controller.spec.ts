import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ImportQuery } from '../domain/http';
import { ImportController } from './import.controller';

describe('ImportController term/translation resolution', () => {
  // The repositories are only used for `create`, which we stub as an identity function
  const repo = { create: (entity: any) => entity };
  const controller: any = new ImportController(null as any, repo as any, repo as any, repo as any, repo as any);
  const project: any = { id: 'project-1' };

  describe('determineTermsToAdd', () => {
    it('adds only terms that do not exist yet', () => {
      const existing = [{ id: 't1', value: 'term.one' }];
      const result = controller.determineTermsToAdd(
        existing,
        [
          { term: 'term.one', translation: 'eins' },
          { term: 'term.two', translation: 'zwei' },
        ],
        project,
      );

      expect(result.map(t => t.value)).toEqual(['term.two']);
    });

    it('adds a term only once when it is repeated within the imported file', () => {
      const result = controller.determineTermsToAdd(
        [],
        [
          { term: 'term.one', translation: 'eins' },
          { term: 'term.one', translation: 'uno' },
        ],
        project,
      );

      expect(result.map(t => t.value)).toEqual(['term.one']);
    });

    it('does not mistake object prototype keys for existing terms', () => {
      const result = controller.determineTermsToAdd(
        [],
        [
          { term: 'constructor', translation: 'a' },
          { term: 'toString', translation: 'b' },
        ],
        project,
      );

      expect(result.map(t => t.value)).toEqual(['constructor', 'toString']);
    });
  });

  describe('determineTranslationsToAdd', () => {
    const projectLocale: any = { id: 'locale-1' };

    it('creates one translation per term, with the last repeated value winning', () => {
      const terms = [{ id: 't1', value: 'term.one', labels: [] }];
      const result = controller.determineTranslationsToAdd(
        terms,
        [
          { term: 'term.one', translation: 'eins' },
          { term: 'term.one', translation: 'uno' },
        ],
        projectLocale,
        [],
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ termId: 't1', projectLocaleId: 'locale-1', value: 'uno' });
    });

    it('resolves terms named like object prototype members', () => {
      const terms = [{ id: 't1', value: 'constructor', labels: [] }];
      const result = controller.determineTranslationsToAdd(terms, [{ term: 'constructor', translation: 'x' }], projectLocale, []);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ termId: 't1', value: 'x' });
    });

    it('throws when a translation has no matching term', () => {
      expect(() => controller.determineTranslationsToAdd([], [{ term: 'missing', translation: 'x' }], projectLocale, [])).toThrow(
        'missing term for translation',
      );
    });

    it('keeps the labels of a stored translation that its term does not have, and adds those of the term once', () => {
      const terms = [
        { id: 't1', value: 'term.one', labels: [{ id: 'l-term' }] },
        { id: 't2', value: 'term.two', labels: [{ id: 'l-term' }] },
        { id: 't3', value: 'term.three', labels: [{ id: 'l-term' }] },
      ];
      const stored = [
        { termId: 't1', value: 'eins', labels: [{ id: 'l-own' }, { id: 'l-term' }] },
        { termId: 't2', value: '', labels: [] },
      ];
      const result = controller.determineTranslationsToAdd(
        terms,
        [
          { term: 'term.one', translation: 'EINS' },
          { term: 'term.two', translation: 'ZWEI' },
          { term: 'term.three', translation: 'DREI' },
        ],
        projectLocale,
        stored,
      );

      const labelIds = (termId: string) => result.find(t => t.termId === termId).labels.map(label => label.id);
      // t1 keeps its own label, t2 (stored without labels) and t3 (new) get the labels of their term
      expect(labelIds('t1')).toEqual(['l-own', 'l-term']);
      expect(labelIds('t2')).toEqual(['l-term']);
      expect(labelIds('t3')).toEqual(['l-term']);
    });
  });

  describe('withoutStoredTranslations', () => {
    const incoming = [
      { termId: 't1', value: 'EINS' },
      { termId: 't2', value: 'ZWEI' },
      { termId: 't3', value: 'DREI' },
    ];

    it('drops the terms that already have a value, and keeps the empty and the missing ones', () => {
      const result = controller.withoutStoredTranslations(incoming, [
        { termId: 't1', value: 'eins' },
        { termId: 't2', value: '' },
      ]);

      expect(result.map(t => t.termId)).toEqual(['t2', 't3']);
    });

    it('keeps everything when nothing is stored yet', () => {
      expect(controller.withoutStoredTranslations(incoming, [])).toEqual(incoming);
    });

    it('treats a whitespace-only stored value as a value', () => {
      expect(controller.withoutStoredTranslations(incoming, [{ termId: 't1', value: ' ' }]).map(t => t.termId)).toEqual(['t2', 't3']);
    });
  });

  describe('ImportQuery overwrite', () => {
    const toQuery = (plain: object) => plainToInstance(ImportQuery, { locale: 'de', format: 'jsonflat', ...plain });

    it('is off only for false', async () => {
      expect(toQuery({ overwrite: 'false' }).overwrite).toBe(false);
      expect(await validate(toQuery({ overwrite: 'false' }))).toHaveLength(0);
    });

    it('stays on for true and when absent', async () => {
      expect(toQuery({ overwrite: 'true' }).overwrite).toBe(true);
      expect(toQuery({}).overwrite).toBeUndefined();
      expect(await validate(toQuery({}))).toHaveLength(0);
    });

    it('rejects any other value', async () => {
      expect(await validate(toQuery({ overwrite: 'maybe' }))).toHaveLength(1);
    });
  });

  describe('determineHistoryToAdd', () => {
    const projectLocale: any = { id: 'locale-1' };
    const user: any = { id: 'user-1' };

    // No `find`: the stored translations are the ones the import read once, passed in
    function entityManager(latest: { termId: string; revision: number | string }[]) {
      const queryBuilder: any = {
        select: jest.fn(() => queryBuilder),
        addSelect: jest.fn(() => queryBuilder),
        where: jest.fn(() => queryBuilder),
        groupBy: jest.fn(() => queryBuilder),
        getRawMany: jest.fn().mockResolvedValue(latest),
      };
      return { createQueryBuilder: jest.fn(() => queryBuilder), queryBuilder };
    }

    it('records each changed value after its latest change, and new translations from an empty value', async () => {
      const em = entityManager([{ termId: 't1', revision: '3' }]);

      const result = await controller.determineHistoryToAdd(
        em,
        projectLocale,
        [
          { termId: 't1', value: 'EINS' },
          { termId: 't2', value: 'zwei' },
          { termId: 't3', value: 'drei' },
        ],
        [
          { termId: 't1', value: 'eins' },
          { termId: 't2', value: 'zwei' },
        ],
        user,
      );

      expect(result).toEqual([
        { termId: 't1', projectLocaleId: 'locale-1', revision: 4, previousValue: 'eins', value: 'EINS', user },
        { termId: 't3', projectLocaleId: 'locale-1', revision: 1, previousValue: '', value: 'drei', user },
      ]);
      expect(em.queryBuilder.where).toHaveBeenCalledWith('history.projectLocaleId = :projectLocaleId', { projectLocaleId: 'locale-1' });
    });

    it('records nothing, and reads no history, when the import changes no value', async () => {
      const em = entityManager([]);

      const result = await controller.determineHistoryToAdd(
        em,
        projectLocale,
        [{ termId: 't1', value: 'eins' }],
        [{ termId: 't1', value: 'eins' }],
        null,
      );

      expect(result).toEqual([]);
      expect(em.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
