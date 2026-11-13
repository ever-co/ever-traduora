import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection, EntityManager } from 'typeorm';
import { ProjectRole } from '../src/entity/project-user.entity';
import { TranslationHistory } from '../src/entity/translation-history.entity';
import { Translation } from '../src/entity/translation.entity';
import './util';
import { createAndMigrateApp, createTestProject, createTestProjectClient, signupTestUser, TestingProject, TestingUser } from './util';

describe('Translation history (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let testProject: TestingProject;
  let termId: string;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    // Listen once: otherwise supertest starts a server for a request and closes it when that request ends, which drops
    // the connections of the parallel requests that have not started yet (read ECONNRESET)
    await app.listen(0, '127.0.0.1');
    testingUser = await signupTestUser(app);
    testProject = await createTestProject(app, testingUser);

    const term = await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ value: 'term.one' })
      .expect(201);
    termId = term.body.data.id;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ code: 'de_DE' })
      .expect(201);
  });

  const edit = (value: string, accessToken = testingUser.accessToken) =>
    request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ termId, value });

  const history = (query = `?termId=${termId}`, accessToken = testingUser.accessToken, localeCode = 'de_DE') =>
    request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/${localeCode}/history${query}`)
      .set('Authorization', `Bearer ${accessToken}`);

  const changes = async () => (await history().expect(200)).body.data.map(entry => [entry.revision, entry.previousValue, entry.value]);

  it('records each change of a value, newest first, and skips saves that change nothing', async () => {
    await edit('Hallo').expect(200);
    await edit('Hallo').expect(200);
    await edit('Hallo Welt').expect(200);

    const res = await history().expect(200);
    expect(res.body.data.map(entry => [entry.revision, entry.previousValue, entry.value])).toEqual([
      [2, 'Hallo', 'Hallo Welt'],
      [1, '', 'Hallo'],
    ]);
    expect(res.body.data[0]).toHaveExactProperties(['id', 'termId', 'revision', 'previousValue', 'value', 'user', 'date']);
    expect(res.body.data[0].user).toEqual({ id: testingUser.id, name: testingUser.name });

    await history(`?termId=${termId}&limit=1`)
      .expect(200)
      .expect(r => expect(r.body.data.map(entry => entry.revision)).toEqual([2]));
    await history('').expect(400);
    await history(`?termId=${termId}`, testingUser.accessToken, 'fr').expect(404);
  });

  it('keeps overlapping edits as an unbroken chain', async () => {
    const values = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6'];
    await Promise.all(values.map(value => edit(value).expect(200)));

    const entries = (await changes()).reverse();
    expect(entries.map(([revision]) => revision)).toEqual([1, 2, 3, 4, 5, 6]);
    entries.forEach(([, previousValue], index) => expect(previousValue).toBe(index === 0 ? '' : entries[index - 1][2]));
  });

  it('records the changes made by an import', async () => {
    await edit('manuell').expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(JSON.stringify({ 'term.one': 'importiert' })), 'file')
      .expect(200);
    await edit('wieder manuell').expect(200);

    expect(await changes()).toEqual([
      [3, 'importiert', 'wieder manuell'],
      [2, 'manuell', 'importiert'],
      [1, '', 'manuell'],
    ]);
  });

  it('keeps the previous value when the history cannot be written', async () => {
    await edit('vorher').expect(200);

    const save = EntityManager.prototype.save;
    const failHistory = jest.spyOn(EntityManager.prototype, 'save').mockImplementation(function (this: EntityManager, ...args: any[]) {
      return args[0] instanceof TranslationHistory ? Promise.reject(new Error('history write failed')) : (save as any).apply(this, args);
    } as any);
    try {
      await edit('nachher').expect(500);
    } finally {
      failHistory.mockRestore();
    }

    const stored = await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200);
    expect(stored.body.data[0].value).toBe('vorher');
    expect(await changes()).toEqual([[1, '', 'vorher']]);
  });

  const importValue = (value: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(JSON.stringify({ 'term.one': value })), 'file');

  const storedValue = async () =>
    (
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .expect(200)
    ).body.data[0].value;

  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  it('records an import and an edit that overlap as one unbroken chain', async () => {
    await edit('A').expect(200);

    // The edit is sent right after the import has read the values it replaces, and gets time to finish before the import goes on
    let editing: Promise<any>;
    const find = EntityManager.prototype.find;
    const pause = jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, ...args: any[]) {
      const result = await (find as any).apply(this, args);
      if (args[0] === Translation && args[1]?.select && !editing) {
        editing = edit('B').then(res => res);
        await sleep(500);
      }
      return result;
    } as any);
    try {
      await importValue('C').expect(200);
      await editing;
    } finally {
      pause.mockRestore();
    }

    const entries = (await changes()).reverse();
    expect(entries.map(([revision]) => revision)).toEqual([1, 2, 3]);
    entries.forEach(([, previousValue], index) => expect(previousValue).toBe(index === 0 ? '' : entries[index - 1][2]));
    expect(await storedValue()).toBe(entries[2][2]);
  });

  it('keeps an import when an overlapping edit fails', async () => {
    await edit('vorher').expect(200);

    // The edit fails its history write after the import has finished, or after 1 s when the import waits for it
    let reached: () => void;
    const editReached = new Promise<void>(resolve => (reached = resolve));
    let imported: () => void;
    const importDone = new Promise<void>(resolve => (imported = resolve));
    const findOne = EntityManager.prototype.findOne;
    const save = EntityManager.prototype.save;
    const pause = jest.spyOn(EntityManager.prototype, 'findOne').mockImplementation(async function (this: EntityManager, ...args: any[]) {
      if (args[0] === TranslationHistory) {
        reached();
        await Promise.race([importDone, sleep(1000)]);
      }
      return (findOne as any).apply(this, args);
    } as any);
    const failHistory = jest.spyOn(EntityManager.prototype, 'save').mockImplementation(function (this: EntityManager, ...args: any[]) {
      return args[0] instanceof TranslationHistory ? Promise.reject(new Error('history write failed')) : (save as any).apply(this, args);
    } as any);
    try {
      const editing = edit('nachher').then(res => res);
      await editReached;
      await importValue('importiert')
        .expect(200)
        .then(() => imported());
      expect((await editing).status).toBe(500);
    } finally {
      pause.mockRestore();
      failHistory.mockRestore();
    }

    expect(await storedValue()).toBe('importiert');
    expect(await changes()).toEqual([
      [2, 'vorher', 'importiert'],
      [1, '', 'vorher'],
    ]);
  });

  it('lets viewers read, records no user for API clients, and hides the history from other users', async () => {
    const editor = await createTestProjectClient(app, testingUser, testProject, ProjectRole.Editor);
    await edit('vom Client', editor.accessToken).expect(200);

    const viewer = await createTestProjectClient(app, testingUser, testProject, ProjectRole.Viewer);
    const res = await history(`?termId=${termId}`, viewer.accessToken).expect(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).not.toHaveProperty('user');

    const anotherUser = await signupTestUser(app, 'another-user@test.com');
    await history(`?termId=${termId}`, anotherUser.accessToken).expect(404);
  });

  it('removes the history with its term or locale, and keeps it without a user when the user is deleted', async () => {
    const repo = app.get(Connection).getRepository(TranslationHistory);
    await edit('Hallo').expect(200);

    await request(app.getHttpServer()).delete('/api/v1/users/me').set('Authorization', `Bearer ${testingUser.accessToken}`).expect(204);
    const kept = await repo.find({ where: { termId }, relations: ['user'] });
    expect(kept).toHaveLength(1);
    expect(kept[0].user).toBeNull();

    const owner = await signupTestUser(app, 'owner@test.com');
    const project = await createTestProject(app, owner);
    const auth = { Authorization: `Bearer ${owner.accessToken}` };
    const termIds: string[] = [];
    for (const value of ['a', 'b']) {
      const term = await request(app.getHttpServer()).post(`/api/v1/projects/${project.id}/terms`).set(auth).send({ value }).expect(201);
      termIds.push(term.body.data.id);
    }
    const [termA, termB] = termIds;
    await request(app.getHttpServer()).post(`/api/v1/projects/${project.id}/translations`).set(auth).send({ code: 'fr' }).expect(201);
    for (const id of [termA, termB]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${project.id}/translations/fr`)
        .set(auth)
        .send({ termId: id, value: 'x' })
        .expect(200);
    }

    await request(app.getHttpServer()).delete(`/api/v1/projects/${project.id}/terms/${termA}`).set(auth).expect(204);
    expect(await repo.count({ where: { termId: termA } })).toBe(0);
    expect(await repo.count({ where: { termId: termB } })).toBe(1);

    await request(app.getHttpServer()).delete(`/api/v1/projects/${project.id}/translations/fr`).set(auth).expect(204);
    expect(await repo.count({ where: { termId: termB } })).toBe(0);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
