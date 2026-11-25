import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import { ProjectLocale } from '../src/entity/project-locale.entity';
import { ProjectRole } from '../src/entity/project-user.entity';
import { TranslationHistory } from '../src/entity/translation-history.entity';
import { DbType, isDbType } from '../src/utils/database-type-helper';
import './util';
import { createAndMigrateApp, createTestProject, createTestProjectClient, signupTestUser, TestingProject, TestingUser } from './util';

describe('Project activity (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let testProject: TestingProject;
  const termIds: { [value: string]: string } = {};

  // More than a second apart: the order of these changes is known from their times alone
  const nextSecond = () => new Promise(resolve => setTimeout(resolve, 1100));
  // Just after the clock turns to a new second, so that the changes made next fall within one second
  const startOfSecond = () => new Promise(resolve => setTimeout(resolve, 1000 - (Date.now() % 1000) + 20));

  beforeEach(async () => {
    app = await createAndMigrateApp();
    await app.listen(0, '127.0.0.1');
    testingUser = await signupTestUser(app);
    testProject = await createTestProject(app, testingUser);

    for (const value of ['term.one', 'term.two']) {
      const term = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({ value })
        .expect(201);
      termIds[value] = term.body.data.id;
    }
    for (const code of ['de_DE', 'fr']) {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/translations`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({ code })
        .expect(201);
    }
  });

  const edit = (term: string, code: string, value: string, accessToken = testingUser.accessToken, projectId = testProject.id) =>
    request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}/translations/${code}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ termId: termIds[term], value });

  const activity = (query = '', accessToken = testingUser.accessToken, projectId = testProject.id) =>
    request(app.getHttpServer()).get(`/api/v1/projects/${projectId}/activity${query}`).set('Authorization', `Bearer ${accessToken}`);

  const summary = (body: any) => body.data.map(entry => [entry.term, entry.locale, entry.revision, entry.previousValue, entry.value]);

  it('lists the changes of every term and locale of the project, newest first', async () => {
    await edit('term.one', 'de_DE', 'eins').expect(200);
    await nextSecond();
    await edit('term.two', 'fr', 'deux').expect(200);
    await nextSecond();
    await edit('term.one', 'de_DE', 'Eins').expect(200);
    await nextSecond();
    await edit('term.two', 'de_DE', 'zwei').expect(200);

    const res = await activity().expect(200);
    expect(summary(res.body)).toEqual([
      ['term.two', 'de_DE', 1, '', 'zwei'],
      ['term.one', 'de_DE', 2, 'eins', 'Eins'],
      ['term.two', 'fr', 1, '', 'deux'],
      ['term.one', 'de_DE', 1, '', 'eins'],
    ]);
    expect(res.body.data[0]).toHaveExactProperties(['id', 'termId', 'term', 'locale', 'revision', 'previousValue', 'value', 'user', 'date']);
    expect(res.body.data[0].termId).toBe(termIds['term.two']);
    expect(res.body.data[0].user).toEqual({ id: testingUser.id, name: testingUser.name });
    const dates = res.body.data.map(entry => new Date(entry.date).getTime());
    dates.forEach(time => expect(Number.isNaN(time)).toBe(false));
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);

    expect(summary((await activity('?locale=fr').expect(200)).body)).toEqual([['term.two', 'fr', 1, '', 'deux']]);
    await activity('?locale=es').expect(404);
    expect(summary((await activity('?limit=2').expect(200)).body)).toHaveLength(2);
    expect(summary((await activity('?limit=0').expect(200)).body)).toHaveLength(1);
    expect(summary((await activity('?limit=-5').expect(200)).body)).toHaveLength(4);
    expect(summary((await activity('?limit=abc').expect(200)).body)).toHaveLength(4);
  });

  it('lists changes made within one second in the order they were made, across translations', async () => {
    await startOfSecond();
    await edit('term.one', 'de_DE', 'eins').expect(200);
    await edit('term.one', 'de_DE', 'Eins').expect(200);
    await edit('term.one', 'de_DE', 'EINS').expect(200);
    await edit('term.two', 'fr', 'deux').expect(200);

    expect(summary((await activity().expect(200)).body)).toEqual([
      ['term.two', 'fr', 1, '', 'deux'],
      ['term.one', 'de_DE', 3, 'Eins', 'EINS'],
      ['term.one', 'de_DE', 2, 'eins', 'Eins'],
      ['term.one', 'de_DE', 1, '', 'eins'],
    ]);
    // A short list keeps the newest change
    expect(summary((await activity('?limit=1').expect(200)).body)).toEqual([['term.two', 'fr', 1, '', 'deux']]);
  });

  // Changes recorded on SQLite before the times had milliseconds keep whole seconds ('2026-11-25 10:00:00')
  (isDbType(DbType.BETTER_SQLITE3) ? it : it.skip)('lists a change stored in whole seconds before a newer one of the same second', async () => {
    await startOfSecond();
    await edit('term.one', 'de_DE', 'eins').expect(200);
    await app
      .get(Connection)
      .query(`UPDATE "translation_history" SET "date_created" = datetime("date_created"), "date_modified" = datetime("date_modified")`);
    // The newer change made by an import, the other way changes are recorded
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=fr&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(JSON.stringify({ 'term.two': 'deux' })), 'file')
      .expect(200);

    expect(summary((await activity().expect(200)).body)).toEqual([
      ['term.two', 'fr', 1, '', 'deux'],
      ['term.one', 'de_DE', 1, '', 'eins'],
    ]);
  });

  it('returns at most 100 changes, and nothing for a project without changes', async () => {
    expect((await activity().expect(200)).body.data).toEqual([]);

    const projectLocale = await app
      .get(Connection)
      .getRepository(ProjectLocale)
      .findOneOrFail({ where: { project: { id: testProject.id }, locale: { code: 'de_DE' } } });
    const projectLocaleId = projectLocale.id;
    const repo = app.get(Connection).getRepository(TranslationHistory);
    const rows = Array.from({ length: 120 }, (_, index) =>
      repo.create({ termId: termIds['term.one'], projectLocaleId, revision: index + 1, previousValue: `${index}`, value: `${index + 1}` }),
    );
    await repo.save(rows, { chunk: 40 });

    expect((await activity().expect(200)).body.data).toHaveLength(50);
    expect((await activity('?limit=100000').expect(200)).body.data).toHaveLength(100);
    expect((await activity('?limit=100').expect(200)).body.data[0].revision).toBe(120);
  });

  it('follows the access rules of the translation history', async () => {
    await edit('term.one', 'de_DE', 'eins').expect(200);

    const editorClient = await createTestProjectClient(app, testingUser, testProject, ProjectRole.Editor);
    await edit('term.one', 'fr', 'un', editorClient.accessToken).expect(200);

    const viewerClient = await createTestProjectClient(app, testingUser, testProject, ProjectRole.Viewer);
    const res = await activity('', viewerClient.accessToken).expect(200);
    expect(summary(res.body)).toHaveLength(2);
    const fromClient = res.body.data.find(entry => entry.locale === 'fr');
    expect(fromClient).not.toHaveProperty('user');

    const viewer = await signupTestUser(app, 'viewer@test.com');
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/invites`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ email: viewer.email, role: ProjectRole.Viewer })
      .expect(201);
    expect((await activity('', viewer.accessToken).expect(200)).body.data).toHaveLength(2);

    // A user of another project reads neither this project's activity nor finds it in their own
    const outsider = await signupTestUser(app, 'outsider@test.com');
    const otherProject = await createTestProject(app, outsider);
    await activity('', outsider.accessToken).expect(404);
    await activity('?locale=de_DE', outsider.accessToken).expect(404);
    expect((await activity('', outsider.accessToken, otherProject.id).expect(200)).body.data).toEqual([]);
    await activity('', testingUser.accessToken, otherProject.id).expect(404);

    // A client of this project cannot read another project
    await activity('', viewerClient.accessToken, otherProject.id).expect(404);

    await request(app.getHttpServer()).get(`/api/v1/projects/${testProject.id}/activity`).expect(401);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
