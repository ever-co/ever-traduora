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
      );

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ termId: 't1', projectLocaleId: 'locale-1', value: 'uno' });
    });

    it('resolves terms named like object prototype members', () => {
      const terms = [{ id: 't1', value: 'constructor', labels: [] }];
      const result = controller.determineTranslationsToAdd(terms, [{ term: 'constructor', translation: 'x' }], projectLocale);

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ termId: 't1', value: 'x' });
    });

    it('throws when a translation has no matching term', () => {
      expect(() => controller.determineTranslationsToAdd([], [{ term: 'missing', translation: 'x' }], projectLocale)).toThrow(
        'missing term for translation',
      );
    });
  });

  describe('determineHistoryToAdd', () => {
    const projectLocale: any = { id: 'locale-1' };
    const user: any = { id: 'user-1' };

    function entityManager(stored: { termId: string; value: string }[], latest: { termId: string; revision: number | string }[]) {
      const queryBuilder: any = {
        select: jest.fn(() => queryBuilder),
        addSelect: jest.fn(() => queryBuilder),
        where: jest.fn(() => queryBuilder),
        groupBy: jest.fn(() => queryBuilder),
        getRawMany: jest.fn().mockResolvedValue(latest),
      };
      return { find: jest.fn().mockResolvedValue(stored), createQueryBuilder: jest.fn(() => queryBuilder), queryBuilder };
    }

    it('records each changed value after its latest change, and new translations from an empty value', async () => {
      const em = entityManager(
        [
          { termId: 't1', value: 'eins' },
          { termId: 't2', value: 'zwei' },
        ],
        [{ termId: 't1', revision: '3' }],
      );

      const result = await controller.determineHistoryToAdd(
        em,
        projectLocale,
        [
          { termId: 't1', value: 'EINS' },
          { termId: 't2', value: 'zwei' },
          { termId: 't3', value: 'drei' },
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
      const em = entityManager([{ termId: 't1', value: 'eins' }], []);

      const result = await controller.determineHistoryToAdd(em, projectLocale, [{ termId: 't1', value: 'eins' }], null);

      expect(result).toEqual([]);
      expect(em.createQueryBuilder).not.toHaveBeenCalled();
    });
  });
});
