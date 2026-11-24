import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
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

  it('labels and unlabels translations while their locale is imported: the labels stay as the label requests left them', async () => {
    // A label of single translations, not of their terms: an import neither adds it nor may remove it
    const labelId = (
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/labels`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({ value: 'reviewed', color: '#202020' })
        .expect(201)
    ).body.data.id;

    const terms = Array.from({ length: 8 }, (_, index) => `labeled.${index}`);
    const valuesOfRound = (round: number) => terms.reduce((values, term) => ({ ...values, [term]: `${term} ${round}` }), {});
    await importTerms(valuesOfRound(-1)).expect(200);
    const termIds: string[] = (
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .expect(200)
    ).body.data
      .filter(term => terms.includes(term.value))
      .map(term => term.id);
    expect(termIds).toHaveLength(terms.length);

    // Each round adds the label to the translations without it and removes it from the others, one request each, spread
    // over the time the import runs, so that some land between its read of the labels and its save of the translations
    const labeled = new Set<string>();
    const toggle = async (termId: string, delayMs: number) => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      const add = !labeled.has(termId);
      const path = `/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}/translations/de_DE`;
      const res = await (add ? request(app.getHttpServer()).post(path) : request(app.getHttpServer()).delete(path)).set(
        'Authorization',
        `Bearer ${testingUser.accessToken}`,
      );
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

      const translations = (
        await request(app.getHttpServer())
          .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .expect(200)
      ).body.data;
      const withLabel = translations.filter(translation => translation.labels.some(label => label.id === labelId)).map(t => t.termId);
      expect({ round, labeled: withLabel.sort() }).toEqual({ round, labeled: [...labeled].sort() });
    }
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
