import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { join } from 'path';
import { DataSource, DataSourceOptions, EntityManager, Logger } from 'typeorm';
import { ImportQuery } from '../domain/http';
import { Label } from '../entity/label.entity';
import { Locale } from '../entity/locale.entity';
import { ProjectLocale } from '../entity/project-locale.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { Translation } from '../entity/translation.entity';
import { SnakeNamingStrategy } from '../utils/snake-naming-strategy';
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

describe('ImportController labels of the imported translations', () => {
  let dataSource: DataSource;
  // The statements the import runs, without those of the label request it runs alongside
  const statements: string[] = [];
  let recording = false;

  beforeEach(async () => {
    const logger: Logger = {
      logQuery: query => {
        if (recording) {
          statements.push(query);
        }
      },
      logQueryError: () => undefined,
      logQuerySlow: () => undefined,
      logSchemaBuild: () => undefined,
      logMigration: () => undefined,
      log: () => undefined,
    };
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      foreignKeys: true,
      entities: [join(__dirname, '../entity/*.entity.ts')],
      migrations: [join(__dirname, '../migrations/*.ts')],
      namingStrategy: new SnakeNamingStrategy(),
      logging: ['query'],
      logger,
    } as DataSourceOptions);
    await dataSource.initialize();
    await dataSource.runMigrations();
    statements.length = 0;
  });

  afterEach(async () => {
    recording = false;
    jest.restoreAllMocks();
    await dataSource.destroy();
  });

  it('never removes a label row: a label added or removed while the import runs stays so', async () => {
    const manager = dataSource.manager;
    const project = await manager.save(Project, { name: 'Project', termsCount: 2, localesCount: 1, plan: { code: 'open-source' } });
    const locale = await manager.findOneByOrFail(Locale, { code: 'de' });
    const projectLocale = await manager.save(ProjectLocale, { project, locale });
    const [own, ofTerm, added] = await manager.save(
      Label,
      ['own', 'term', 'added'].map(value => ({ value, color: '#202020', project })),
    );
    // Both terms have the label `term`; the stored translation of term.one has only its own label `own`, and term.two
    // has no translation yet
    const termOne = await manager.save(Term, { value: 'term.one', project, labels: [ofTerm] });
    const termTwo = await manager.save(Term, { value: 'term.two', project, labels: [ofTerm] });
    await manager.save(Translation, { termId: termOne.id, projectLocaleId: projectLocale.id, value: 'eins', labels: [own] });

    // A label request that is done after the import has read the labels of the locale, before it writes the translations:
    // it removes `own` from the translation of term.one and adds `added` to it
    const find = EntityManager.prototype.find;
    let labelRequestDone = false;
    jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, target: any, options: any) {
      const found = await find.call(this, target, options);
      if (target === Translation && !labelRequestDone) {
        labelRequestDone = true;
        recording = false;
        const labels = this.createQueryBuilder().relation(Translation, 'labels').of({ termId: termOne.id, projectLocaleId: projectLocale.id });
        await labels.remove(own.id);
        await labels.add(added.id);
        recording = true;
      }
      return found;
    } as any);

    const auth: any = { getRequestUserOrClient: () => ({}), authorizeProjectAction: async () => ({ project }) };
    const controller = new ImportController(
      auth,
      dataSource.getRepository(Translation),
      dataSource.getRepository(Term),
      dataSource.getRepository(ProjectLocale),
      dataSource.getRepository(Locale),
    );
    const file = { buffer: Buffer.from(JSON.stringify({ 'term.one': 'EINS', 'term.two': 'ZWEI' })) };

    recording = true;
    const result = await controller.import({}, project.id, plainToInstance(ImportQuery, { locale: 'de', format: 'jsonflat' }), file);
    recording = false;

    expect(labelRequestDone).toBe(true);
    expect(result.data.translations.upserted).toBe(2);
    const translationOf = (term: Term) =>
      manager.findOneOrFail(Translation, { where: { termId: term.id, projectLocaleId: projectLocale.id }, relations: ['labels'] });
    const one = await translationOf(termOne);
    const two = await translationOf(termTwo);
    expect([one.value, two.value]).toEqual(['EINS', 'ZWEI']);
    // The label request's change stays, and each translation gets the label of its term it is missing
    expect(one.labels.map(label => label.value).sort()).toEqual(['added', 'term']);
    expect(two.labels.map(label => label.value)).toEqual(['term']);
    // The import only adds label rows
    const labelStatements = statements.filter(statement => statement.includes('label_translations_translation'));
    expect(labelStatements.filter(statement => /^\s*(DELETE|UPDATE)\b/i.test(statement))).toEqual([]);
  });

  it('keeps a label removed from a term and then from its translation after the import read the first labels', async () => {
    const manager = dataSource.manager;
    const project = await manager.save(Project, { name: 'Project', termsCount: 1, localesCount: 1, plan: { code: 'open-source' } });
    const locale = await manager.findOneByOrFail(Locale, { code: 'de' });
    const projectLocale = await manager.save(ProjectLocale, { project, locale });
    const ofTerm = await manager.save(Label, { value: 'term', color: '#202020', project });
    const term = await manager.save(Term, { value: 'term.one', project, labels: [ofTerm] });
    const where = { termId: term.id, projectLocaleId: projectLocale.id };
    await manager.save(Translation, { ...where, value: 'eins', labels: [ofTerm] });

    // Right after the import's first read of labels (those of the terms or those of the translations), the label is
    // removed from the term and then from its translation
    const find = EntityManager.prototype.find;
    let labelRequestsDone = false;
    jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, target: any, options: any) {
      const found = await find.call(this, target, options);
      if ((target === Term || target === Translation) && !labelRequestsDone) {
        labelRequestsDone = true;
        await this.createQueryBuilder().relation(Term, 'labels').of(term.id).remove(ofTerm.id);
        await this.createQueryBuilder().relation(Translation, 'labels').of(where).remove(ofTerm.id);
      }
      return found;
    } as any);

    const auth: any = { getRequestUserOrClient: () => ({}), authorizeProjectAction: async () => ({ project }) };
    const controller = new ImportController(
      auth,
      dataSource.getRepository(Translation),
      dataSource.getRepository(Term),
      dataSource.getRepository(ProjectLocale),
      dataSource.getRepository(Locale),
    );
    const file = { buffer: Buffer.from(JSON.stringify({ 'term.one': 'EINS' })) };
    await controller.import({}, project.id, plainToInstance(ImportQuery, { locale: 'de', format: 'jsonflat' }), file);

    expect(labelRequestsDone).toBe(true);
    const translation = await manager.findOneOrFail(Translation, { where, relations: ['labels'] });
    expect(translation.value).toBe('EINS');
    expect(translation.labels).toEqual([]);
  });
});
