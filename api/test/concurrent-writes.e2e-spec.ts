import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection, EntityManager } from 'typeorm';
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
    const byValue = (a: string, b: string) => a.localeCompare(b);

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

    const labelRequest = (method: 'post' | 'delete', labelId: string, termId: string) =>
      request(app.getHttpServer())
        [method](`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}/translations/de_DE`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`);

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
      const statuses: number[] = [];
      jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, target: any, options: any) {
        const found = await find.call(this, target, options);
        // The import's read of the locale's translations with the ids of their labels
        if (target === Translation && options?.select?.labels && statuses.length === 0) {
          statuses.push((await labelRequest('delete', labelId, termOneId)).status);
          statuses.push((await labelRequest('post', labelId, termTwoId)).status);
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
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
