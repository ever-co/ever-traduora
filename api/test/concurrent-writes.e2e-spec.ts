import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection, EntityManager } from 'typeorm';
import { Project } from '../src/entity/project.entity';
import { Term } from '../src/entity/term.entity';
import { Translation } from '../src/entity/translation.entity';
import { DbType, isDbType } from '../src/utils/database-type-helper';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

// Requests that change the same project at the same time, as editors and imports do: none may fail because of the
// other (on MySQL these deadlocked when their transactions locked the project and its locale in different orders)
describe('Concurrent writes to one project (e2e)', () => {
  const rounds = 8;
  let app: INestApplication;
  let testingUser: TestingUser;
  let testProject: TestingProject;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    // Listen once, so that supertest does not close a server of its own while parallel requests use it
    await app.listen(0, '127.0.0.1');
    testingUser = await signupTestUser(app);
    testProject = await createTestProject(app, testingUser);
    await addTerm('term.one').expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ code: 'de_DE' })
      .expect(201);
  });

  const addTerm = (value: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ value });

  const importTerms = (content: Record<string, string>) =>
    request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(JSON.stringify(content)), 'file');

  const labelRequest = (method: 'post' | 'delete', labelId: string, termId: string) =>
    request(app.getHttpServer())
      [method](`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`);

  const byValue = (a: string, b: string) => a.localeCompare(b);

  it('adds terms and imports at the same time', async () => {
    for (let round = 0; round < rounds; round++) {
      const [imported, added, alsoAdded] = await Promise.all([
        importTerms({ 'term.one': `eins ${round}`, [`imported.${round}`]: 'neu' }),
        addTerm(`added.${round}`),
        addTerm(`also.added.${round}`),
      ]);
      expect([imported.status, added.status, alsoAdded.status]).toEqual([200, 201, 201]);
    }

    const project = await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200);
    expect(project.body.data.termsCount).toBe(1 + 3 * rounds);
  });

  it('edits a translation while its term is deleted: the edit is done first or not found', async () => {
    for (let round = 0; round < rounds; round++) {
      const termId = (await addTerm(`deleted.${round}`).expect(201)).body.data.id;
      const [edited, deleted] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .send({ termId, value: `wert ${round}` }),
        request(app.getHttpServer())
          .delete(`/api/v1/projects/${testProject.id}/terms/${termId}`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`),
      ]);
      expect([200, 404]).toContain(edited.status);
      expect(deleted.status).toBe(204);
    }
  });

  describe('labels of the translations of a locale being imported', () => {
    // A label of single translations, not of their terms: an import neither adds it nor may remove it
    const createLabel = async (): Promise<string> =>
      (
        await request(app.getHttpServer())
          .post(`/api/v1/projects/${testProject.id}/labels`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .send({ value: 'reviewed', color: '#202020' })
          .expect(201)
      ).body.data.id;

    const termIdsOf = async (values: string[]): Promise<string[]> => {
      const terms = (
        await request(app.getHttpServer())
          .get(`/api/v1/projects/${testProject.id}/terms`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .expect(200)
      ).body.data;
      return values.map(value => terms.find(term => term.value === value).id);
    };

    const termIdsWithLabel = async (labelId: string): Promise<string[]> =>
      (
        await request(app.getHttpServer())
          .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .expect(200)
      ).body.data
        .filter(translation => translation.labels.some(label => label.id === labelId))
        .map(translation => translation.termId)
        .sort(byValue);

    it('labels and unlabels translations while their locale is imported: the labels stay as the label requests left them', async () => {
      const labelId = await createLabel();
      const terms = Array.from({ length: 8 }, (_, index) => `labeled.${index}`);
      const valuesOfRound = (round: number) => terms.reduce((values, term) => ({ ...values, [term]: `${term} ${round}` }), {});
      await importTerms(valuesOfRound(-1)).expect(200);
      const termIds = await termIdsOf(terms);

      // Each round adds the label to the translations without it and removes it from the others, one request each, spread
      // over the time the import runs, so that some land between its read of the labels and its save of the translations
      const labeled = new Set<string>();
      const toggle = async (termId: string, delayMs: number) => {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        const add = !labeled.has(termId);
        const res = await labelRequest(add ? 'post' : 'delete', labelId, termId);
        expect(res.status).toBe(add ? 201 : 204);
        if (add) {
          labeled.add(termId);
        } else {
          labeled.delete(termId);
        }
      };

      for (let round = 0; round < 2 * rounds; round++) {
        const [imported] = await Promise.all([importTerms(valuesOfRound(round)), ...termIds.map((termId, index) => toggle(termId, 3 * index))]);
        expect(imported.status).toBe(200);
        expect({ round, labeled: await termIdsWithLabel(labelId) }).toEqual({ round, labeled: [...labeled].sort(byValue) });
      }
    });

    // The same, with the label requests done at that point for sure: the import waits for them right after its read of the
    // labels. Not on SQLite, which runs one transaction at a time, so the requests would wait for the import
    (isDbType(DbType.BETTER_SQLITE3) ? it.skip : it)('keeps a label added and one removed after the import read the labels', async () => {
      const labelId = await createLabel();
      await importTerms({ 'term.one': 'eins', 'term.two': 'zwei' }).expect(200);
      const [termOneId, termTwoId] = await termIdsOf(['term.one', 'term.two']);
      await labelRequest('post', labelId, termOneId).expect(201);

      const find = EntityManager.prototype.find;
      let statuses: number[] = [];
      let paused = false;
      jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, target: any, options: any) {
        const found = await find.call(this, target, options);
        // The import's read of the locale's translations with the ids of their labels
        if (target === Translation && options?.select?.labels && !paused) {
          paused = true;
          const unlabeled = await labelRequest('delete', labelId, termOneId);
          const labeled = await labelRequest('post', labelId, termTwoId);
          statuses = [unlabeled.status, labeled.status];
        }
        return found;
      } as any);
      try {
        await importTerms({ 'term.one': 'EINS', 'term.two': 'ZWEI' }).expect(200);
      } finally {
        jest.restoreAllMocks();
      }

      expect(statuses).toEqual([204, 201]);
      expect(await termIdsWithLabel(labelId)).toEqual([termTwoId]);
    });

    // A label of the term this time: it is removed from the term and then from the translation while the import waits right
    // after its first read of labels (those of the terms or those of the translations). Not on SQLite, as above
    (isDbType(DbType.BETTER_SQLITE3) ? it.skip : it)(
      'keeps a label removed from a term and then from its translation during the import',
      async () => {
        const labelId = await createLabel();
        await importTerms({ 'term.one': 'eins' }).expect(200);
        const [termOneId] = await termIdsOf(['term.one']);
        const termLabelRequest = (method: 'post' | 'delete') =>
          request(app.getHttpServer())
            [method](`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termOneId}`)
            .set('Authorization', `Bearer ${testingUser.accessToken}`);
        await termLabelRequest('post').expect(201);
        expect(await termIdsWithLabel(labelId)).toEqual([termOneId]);

        const find = EntityManager.prototype.find;
        let statuses: number[] = [];
        let paused = false;
        jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, target: any, options: any) {
          const found = await find.call(this, target, options);
          const readsLabels = (target === Term && options?.relations?.includes?.('labels')) || (target === Translation && options?.select?.labels);
          if (readsLabels && !paused) {
            paused = true;
            const unlabeledTerm = await termLabelRequest('delete');
            const unlabeledTranslation = await labelRequest('delete', labelId, termOneId);
            statuses = [unlabeledTerm.status, unlabeledTranslation.status];
          }
          return found;
        } as any);
        try {
          await importTerms({ 'term.one': 'EINS' }).expect(200);
        } finally {
          jest.restoreAllMocks();
        }

        expect(statuses).toEqual([204, 204]);
        expect(await termIdsWithLabel(labelId)).toEqual([]);
      },
    );
  });

  describe('labels of one term and its translations changed at the same time', () => {
    let termId: string;

    beforeEach(async () => {
      termId = (
        await request(app.getHttpServer())
          .get(`/api/v1/projects/${testProject.id}/terms`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .expect(200)
      ).body.data.find(term => term.value === 'term.one').id;
    });

    const createLabel = async (value: string): Promise<string> =>
      (
        await request(app.getHttpServer())
          .post(`/api/v1/projects/${testProject.id}/labels`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .send({ value, color: '#202020' })
          .expect(201)
      ).body.data.id;

    const termLabelRequest = (method: 'post' | 'delete', labelId: string) =>
      request(app.getHttpServer())
        [method](`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`);

    const labelIdsOfTerm = async (): Promise<string[]> =>
      (
        await request(app.getHttpServer())
          .get(`/api/v1/projects/${testProject.id}/terms`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .expect(200)
      ).body.data
        .find(term => term.id === termId)
        .labels.map(label => label.id)
        .sort(byValue);

    const labelIdsOfTranslation = async (localeCode: string): Promise<string[]> =>
      (
        await request(app.getHttpServer())
          .get(`/api/v1/projects/${testProject.id}/translations/${localeCode}`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .expect(200)
      ).body.data
        .find(translation => translation.termId === termId)
        .labels.map(label => label.id)
        .sort(byValue);

    // Runs `during` once, right after the first read of a `target` row by `findOneOrFail`, then goes on with what was read
    const pauseAfterFirstRead = (target: any, during: () => Promise<void>) => {
      const findOneOrFail = EntityManager.prototype.findOneOrFail;
      let paused = false;
      jest.spyOn(EntityManager.prototype, 'findOneOrFail').mockImplementation(async function (this: EntityManager, entity: any, options: any) {
        const found = await findOneOrFail.call(this, entity, options);
        if (entity === target && !paused) {
          paused = true;
          await during();
        }
        return found;
      } as any);
    };

    it('labels a term with two labels at once: the term and its translation keep both', async () => {
      const [firstId, secondId] = [await createLabel('first'), await createLabel('second')];

      // The second label is added while the request of the first one waits right after its read of the term
      let status: number;
      pauseAfterFirstRead(Term, async () => {
        status = (await termLabelRequest('post', secondId)).status;
      });
      try {
        await termLabelRequest('post', firstId).expect(201);
      } finally {
        jest.restoreAllMocks();
      }

      expect(status).toBe(201);
      expect(await labelIdsOfTerm()).toEqual([firstId, secondId].sort(byValue));
      expect(await labelIdsOfTranslation('de_DE')).toEqual([firstId, secondId].sort(byValue));
    });

    it('labels a term with the same label twice at once: both requests are done and the label is there once', async () => {
      const labelId = await createLabel('twice');

      let status: number;
      pauseAfterFirstRead(Term, async () => {
        status = (await termLabelRequest('post', labelId)).status;
      });
      try {
        await termLabelRequest('post', labelId).expect(201);
      } finally {
        jest.restoreAllMocks();
      }

      expect(status).toBe(201);
      expect(await labelIdsOfTerm()).toEqual([labelId]);
      expect(await labelIdsOfTranslation('de_DE')).toEqual([labelId]);
    });

    it('unlabels a translation while another label is added to it: the other label stays', async () => {
      const [removedId, addedId] = [await createLabel('removed'), await createLabel('added')];
      await labelRequest('post', removedId, termId).expect(201);

      // The other label is added while the unlabel request waits right after its read of the translation
      let status: number;
      pauseAfterFirstRead(Translation, async () => {
        status = (await labelRequest('post', addedId, termId)).status;
      });
      try {
        await labelRequest('delete', removedId, termId).expect(204);
      } finally {
        jest.restoreAllMocks();
      }

      expect(status).toBe(201);
      expect(await labelIdsOfTranslation('de_DE')).toEqual([addedId]);
    });

    // A label added to the term while an import adds the term's translation in a new locale: the import read the labels
    // of the terms before, so the label request has to label that translation, which it can see only once the import
    // committed. Not on SQLite, which runs one transaction at a time, so the import and the label request never interleave
    (isDbType(DbType.BETTER_SQLITE3) ? it.skip : it)(
      'labels a term while an import adds its translation: the new translation gets the label',
      async () => {
        const labelId = await createLabel('labeled');

        // Resolved when the label request asks for its share lock on the project, which the import holds
        let lockRequested: () => void;
        const waitsForLock = new Promise<void>(resolve => (lockRequested = resolve));
        const findOne = EntityManager.prototype.findOne;
        jest.spyOn(EntityManager.prototype, 'findOne').mockImplementation(function (this: EntityManager, target: any, options: any) {
          if (target === Project && options?.lock?.mode === 'pessimistic_read') {
            lockRequested();
          }
          return findOne.call(this, target, options);
        } as any);

        const find = EntityManager.prototype.find;
        let paused = false;
        let labeled: Promise<number>;
        jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, target: any, options: any) {
          const found = await find.call(this, target, options);
          // The import's read of the terms with their labels
          if (target === Term && options?.relations?.includes?.('labels') && !paused) {
            paused = true;
            // Not awaited: the label request may wait for the import to commit. The import goes on once the request is done
            // or waits for the project
            labeled = termLabelRequest('post', labelId).then(res => res.status);
            await Promise.race([labeled, waitsForLock]);
          }
          return found;
        } as any);
        try {
          await request(app.getHttpServer())
            .post(`/api/v1/projects/${testProject.id}/imports?locale=fr_FR&format=jsonflat`)
            .set('Authorization', `Bearer ${testingUser.accessToken}`)
            .attach('file', Buffer.from(JSON.stringify({ 'term.one': 'un' })), 'file')
            .expect(200);
        } finally {
          jest.restoreAllMocks();
        }

        expect(await labeled).toBe(201);
        expect(await labelIdsOfTerm()).toEqual([labelId]);
        expect(await labelIdsOfTranslation('de_DE')).toEqual([labelId]);
        expect(await labelIdsOfTranslation('fr_FR')).toEqual([labelId]);
      },
    );

    describe('while a translation of the term is added in another way than an import', () => {
      // A locale in which the term has no translation yet: an import adds translations to the imported locale only
      beforeEach(async () => {
        await request(app.getHttpServer())
          .post(`/api/v1/projects/${testProject.id}/imports?locale=fr_FR&format=jsonflat`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .attach('file', Buffer.from(JSON.stringify({ 'term.two': 'deux' })), 'file')
          .expect(200);
      });

      // The first save of the term's value in that locale adds its translation
      const saveFirstValue = () =>
        request(app.getHttpServer())
          .patch(`/api/v1/projects/${testProject.id}/translations/fr_FR`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .send({ termId, value: 'un' });

      // A label of the term's translation in that locale adds the translation too
      const labelNewTranslation = (labelId: string) =>
        request(app.getHttpServer())
          .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}/translations/fr_FR`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`);

      it('labels a term while the first save of a value adds its translation: the new translation gets the label', async () => {
        const [firstId, secondId] = [await createLabel('first'), await createLabel('second')];
        await termLabelRequest('post', firstId).expect(201);

        // The second label is added to the term while the save waits right after its read of the term
        let status: number;
        pauseAfterFirstRead(Term, async () => {
          status = (await termLabelRequest('post', secondId)).status;
        });
        try {
          await saveFirstValue().expect(200);
        } finally {
          jest.restoreAllMocks();
        }

        expect(status).toBe(201);
        expect(await labelIdsOfTerm()).toEqual([firstId, secondId].sort(byValue));
        expect(await labelIdsOfTranslation('fr_FR')).toEqual([firstId, secondId].sort(byValue));
      });

      it('labels a term while a label of its translation adds that translation: the new translation gets both labels', async () => {
        const [termLabelId, translationLabelId] = [await createLabel('of the term'), await createLabel('of the translation')];

        // The label is added to the term while the request of the other one waits right after its read of the term
        let status: number;
        pauseAfterFirstRead(Term, async () => {
          status = (await termLabelRequest('post', termLabelId)).status;
        });
        try {
          await labelNewTranslation(translationLabelId).expect(201);
        } finally {
          jest.restoreAllMocks();
        }

        expect(status).toBe(201);
        expect(await labelIdsOfTerm()).toEqual([termLabelId]);
        expect(await labelIdsOfTranslation('fr_FR')).toEqual([termLabelId, translationLabelId].sort(byValue));
      });

      // Starts a label of the term right after the first read of the term with its labels by `findOneOrFail`: the read
      // that copies them into the new translation. The paused request goes on once the label request is done or asks for
      // its lock on the term, which the paused request may hold until it commits. Resolves with the label request's status
      const labelTermRightAfterLabelsRead = (labelId: string): (() => Promise<number>) => {
        let lockRequested: () => void;
        const waitsForLock = new Promise<void>(resolve => (lockRequested = resolve));
        const findOne = EntityManager.prototype.findOne;
        jest.spyOn(EntityManager.prototype, 'findOne').mockImplementation(function (this: EntityManager, target: any, options: any) {
          if (target === Term && ['for_no_key_update', 'pessimistic_write'].includes(options?.lock?.mode)) {
            lockRequested();
          }
          return findOne.call(this, target, options);
        } as any);

        const findOneOrFail = EntityManager.prototype.findOneOrFail;
        let labeled: Promise<number>;
        jest.spyOn(EntityManager.prototype, 'findOneOrFail').mockImplementation(async function (this: EntityManager, target: any, options: any) {
          const found = await findOneOrFail.call(this, target, options);
          if (target === Term && options?.relations?.includes?.('labels') && !labeled) {
            // Not awaited: the label request may wait for the paused request to commit
            labeled = termLabelRequest('post', labelId).then(res => res.status);
            await Promise.race([labeled, waitsForLock]);
          }
          return found;
        } as any);
        return () => labeled;
      };

      // The same with the label request done or waiting at that point for sure, after the read of the labels in the
      // transaction that adds the translation. Not on SQLite, which runs one transaction at a time
      (isDbType(DbType.BETTER_SQLITE3) ? it.skip : it)(
        'labels a term right after the first save of a value read its labels: the new translation gets the label',
        async () => {
          const labelId = await createLabel('labeled');

          const labeled = labelTermRightAfterLabelsRead(labelId);
          try {
            await saveFirstValue().expect(200);
          } finally {
            jest.restoreAllMocks();
          }

          expect(await labeled()).toBe(201);
          expect(await labelIdsOfTerm()).toEqual([labelId]);
          expect(await labelIdsOfTranslation('fr_FR')).toEqual([labelId]);
        },
      );

      (isDbType(DbType.BETTER_SQLITE3) ? it.skip : it)(
        'labels a term right after a label of its translation read its labels: the new translation gets both labels',
        async () => {
          const [termLabelId, translationLabelId] = [await createLabel('of the term'), await createLabel('of the translation')];

          const labeled = labelTermRightAfterLabelsRead(termLabelId);
          try {
            await labelNewTranslation(translationLabelId).expect(201);
          } finally {
            jest.restoreAllMocks();
          }

          expect(await labeled()).toBe(201);
          expect(await labelIdsOfTerm()).toEqual([termLabelId]);
          expect(await labelIdsOfTranslation('fr_FR')).toEqual([termLabelId, translationLabelId].sort(byValue));
        },
      );
    });
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
