import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';
import { propertiesParser } from '../src/formatters/properties';
import { csvParser } from '../src/formatters/csv';

describe('ExportController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let anotherUser: TestingUser;
  let testProject: TestingProject;

  let termOneId: string;
  let termTwoId: string;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    anotherUser = await signupTestUser(app, 'another-user@test.com');
    testProject = await createTestProject(app, testingUser);

    // Terms
    {
      let res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          value: 'term.one',
        });

      termOneId = res.body.data.id;

      res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          value: 'term.two',
        });

      termTwoId = res.body.data.id;
    }

    // Locales

    {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/translations`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          code: 'de_DE',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          termId: termOneId,
          value: 'eins',
        })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          termId: termTwoId,
          value: 'zwei',
        })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/translations`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          code: 'fr',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/fr`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          termId: termOneId,
          value: 'un',
        })
        .expect(200);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/fr`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          termId: termTwoId,
          value: 'deux ⛄ 😀👍 🍉你好',
        })
        .expect(200);
    }
  });

  it('/api/v1/projects/:projectId/exports?format=jsonflat (GET) should export project translation in JSON flat format', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        expect(Object.keys(parsed)).toHaveLength(2);
        expect(parsed['term.two']).toEqual('zwei');
        expect(parsed['term.one']).toEqual('eins');
      });
  });

  it('/api/v1/projects/:projectId/exports (GET) should fill untranslated terms from the fallback locale, matched by term', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ code: 'nl' })
      .expect(201);

    // Only the second term is translated, so the locale's own list is shifted against the fallback's
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/nl`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ termId: termTwoId, value: 'twee' })
      .expect(200);

    const exportWithFallback = async (format: string): Promise<string> => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject.id}/exports?locale=nl&format=${format}&fallbackLocale=de_DE`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .expect(200);
      return Buffer.from(res.body).toString('utf-8');
    };

    expect(JSON.parse(await exportWithFallback('jsonflat'))).toEqual({ 'term.one': 'eins', 'term.two': 'twee' });

    // CSV keeps every entry, so a dropped or duplicated term shows up here
    const csv = await csvParser(await exportWithFallback('csv'));
    expect(csv.translations).toEqual([
      { term: 'term.one', translation: 'eins' },
      { term: 'term.two', translation: 'twee' },
    ]);
  });

  it('/api/v1/projects/:projectId/exports (GET) should include terms without a translation row when exporting untranslated', async () => {
    // Importing into de_DE creates the term and its de_DE translation only, so "greeting" has no row for fr
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(JSON.stringify({ greeting: 'Hallo' })), 'file')
      .expect(200);

    // A term with an empty row in fr is untranslated as well
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ termId: termTwoId, value: '' })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=fr&format=jsonflat&untranslated=true`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        // term.one has a fr value, so it stays out
        expect(parsed).toEqual({ greeting: '', 'term.two': '' });
      });
  });

  it('/api/v1/projects/:projectId/exports (GET) should export only the untranslated terms when filled from the fallback locale', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ code: 'en' })
      .expect(201);

    for (const [termId, value] of [
      [termOneId, 'one'],
      [termTwoId, 'two'],
    ]) {
      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/en`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({ termId, value })
        .expect(200);
    }

    // term.one keeps its de_DE value "eins", term.two is untranslated in de_DE
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ termId: termTwoId, value: '' })
      .expect(200);

    // Importing into en creates the term and its en translation only, so "greeting" has no row for de_DE
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=en&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(JSON.stringify({ greeting: 'Hello' })), 'file')
      .expect(200);

    // Importing into fr creates "farewell" with no value in de_DE nor in en: it is exported, empty
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=fr&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(JSON.stringify({ farewell: 'Au revoir' })), 'file')
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=true&fallbackLocale=en`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        // term.one is translated in de_DE, so it stays out: imported back, the file would overwrite "eins"
        expect(parsed).toEqual({ farewell: '', greeting: 'Hello', 'term.two': 'two' });
      });
  });

  it('/api/v1/projects/:projectId/exports (GET) should keep untranslated terms when the fallback locale is not in the project', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ termId: termTwoId, value: '' })
      .expect(200);

    // "it" is a known locale code, but the project has no it locale, so there is nothing to fill from
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=false&fallbackLocale=it`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        expect(parsed).toEqual({ 'term.one': 'eins', 'term.two': '' });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=true&fallbackLocale=it`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        expect(parsed).toEqual({ 'term.two': '' });
      });
  });

  it('/api/v1/projects/:projectId/exports (GET) should export terms in lexical order', async () => {
    const input = ['app.login', 'should be before base terms', '1 goes first', 'app.logout', 'app.exit', 'menu.start', 'a term', '2 goes second'];

    // Account for term.one and term.two from base test
    const expected = [
      '1 goes first',
      '2 goes second',
      'a term',
      'app.exit',
      'app.login',
      'app.logout',
      'menu.start',
      'should be before base terms',
      'term.one',
      'term.two',
    ];

    for (const term of input) {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          value: term,
        })
        .expect(201);
    }

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        const terms = Object.keys(parsed);
        expect(terms).toHaveLength(expected.length);
        expect(terms).toEqual(expected);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=properties&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(async res => {
        const parsed = await propertiesParser(Buffer.from(res.body).toString());
        const terms = parsed.translations.map(t => t.term);
        expect(terms).toHaveLength(expected.length);
        expect(terms).toEqual(expected);
      });
  });

  it('/api/v1/projects/:projectId/exports (GET) should export translation with utf-8 characters in various formats', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=fr&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        expect(Object.keys(parsed)).toHaveLength(2);
        expect(parsed['term.two']).toEqual('deux ⛄ 😀👍 🍉你好');
        expect(parsed['term.one']).toEqual('un');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=fr&format=properties&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(async res => {
        const payload = Buffer.from(res.body).toString();
        expect(payload).toContain('deux \\u26c4 \\ud83d\\ude00\\ud83d\\udc4d \\ud83c\\udf49\\u4f60\\u597d');
        const parsed = await propertiesParser(payload);
        expect(Object.keys(parsed.translations)).toHaveLength(2);
        expect(parsed.translations.find(t => t.term === 'term.two').translation).toEqual('deux ⛄ 😀👍 🍉你好');
        expect(parsed.translations.find(t => t.term === 'term.one').translation).toEqual('un');
      });
  });

  it('/api/v1/projects/:projectId/exports?format=jsonflat (GET) should include empty translations on export', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'es_CR',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=es_CR&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        expect(Object.keys(parsed)).toHaveLength(2);
        expect(parsed['term.two']).toEqual('');
        expect(parsed['term.one']).toEqual('');
      });
  });

  it('/api/v1/projects/:projectId/exports?format=jsonflat (GET) should not export if params are missing or invalid', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400);

    // unknown locale
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=dd_DD&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(404);

    // unknown format
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=flatjson&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400);
  });

  it('/api/v1/projects/:projectId/exports (GET) should answer 400 when a nested format cannot hold a term that is also a parent', async () => {
    for (const value of ['button', 'button.tooltip']) {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({ value })
        .expect(201);
    }

    for (const format of ['jsonnested', 'yamlnested', 'php']) {
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=${format}&untranslated=false`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .expect(400)
        .expect(res => {
          expect(res.body.error.code).toEqual('BadRequest');
          // the message names both terms, so the user knows which one to rename
          expect(res.body.error.message).toContain('cannot hold the term "button" together with "button.tooltip"');
        });
    }

    // a flat format holds both terms
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        expect(parsed).toEqual({ button: '', 'button.tooltip': '', 'term.one': 'eins', 'term.two': 'zwei' });
      });
  });

  it('/api/v1/projects/:projectId/exports (GET) should answer 400 naming the term when ARB cannot hold a term starting with @', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ value: '@x' })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=arb&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400)
      .expect(res => {
        expect(res.body.error.code).toEqual('BadRequest');
        expect(res.body.error.message).toContain('rename these terms before exporting: @x');
      });
  });

  it('/api/v1/projects/:projectId/exports?format=jsonflat (GET) should not export if locale does not exist for project', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=es&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(404);
  });

  it('/api/v1/projects/:projectId/exports (GET) should send an ETag and answer a matching If-None-Match with an empty 304', async () => {
    const url = `/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=false`;
    const get = (ifNoneMatch?: string) => {
      const req = request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${testingUser.accessToken}`);
      return ifNoneMatch === undefined ? req : req.set('If-None-Match', ifNoneMatch);
    };

    const first = await get().expect(200);
    const etag = first.header.etag;
    expect(etag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(first.header['cache-control']).toEqual('private, no-cache');
    expect(first.header['access-control-expose-headers']).toEqual('ETag');

    // The same content gives the same tag
    await get().expect(200).expect('ETag', etag);

    for (const ifNoneMatch of [etag, `W/${etag}`, `"old", ${etag}`, '*']) {
      await get(ifNoneMatch)
        .expect(304)
        .expect(res => {
          expect(res.header.etag).toEqual(etag);
          expect(res.header['cache-control']).toEqual('private, no-cache');
          expect(res.header['content-length']).toBeUndefined();
          expect(res.text ?? '').toEqual('');
        });
    }

    await request(app.getHttpServer()).head(url).set('Authorization', `Bearer ${testingUser.accessToken}`).set('If-None-Match', etag).expect(304);

    // A tag that is not the current one, even one holding ",*," inside its quotes, gets the whole file
    for (const ifNoneMatch of ['"other"', '"old,*,tag"', etag.slice(1, -1)]) {
      await get(ifNoneMatch)
        .expect(200)
        .expect(res => expect(JSON.parse(Buffer.from(res.body).toString('utf-8'))['term.one']).toEqual('eins'));
    }

    // Another format is another file, with another tag
    const csv = await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=csv&untranslated=false`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .set('If-None-Match', etag)
      .expect(200);
    expect(csv.header.etag).not.toEqual(etag);

    // A changed translation changes the tag: the old tag gets the new file
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ termId: termOneId, value: 'eins!' })
      .expect(200);

    const changed = await get(etag).expect(200);
    expect(changed.header.etag).not.toEqual(etag);
    expect(JSON.parse(Buffer.from(changed.body).toString('utf-8'))['term.one']).toEqual('eins!');
    await get(changed.header.etag).expect(304);
  });

  it('/api/v1/projects/:projectId/exports (GET) should not answer 304 to a caller without access, even with the current ETag', async () => {
    const url = `/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=false`;
    const res = await request(app.getHttpServer()).get(url).set('Authorization', `Bearer ${testingUser.accessToken}`).expect(200);
    const etag = res.header.etag;
    expect(etag).toBeDefined();

    await request(app.getHttpServer())
      .get(url)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .set('If-None-Match', etag)
      .expect(404)
      .expect(denied => expect(denied.header.etag).toBeUndefined());
    await request(app.getHttpServer()).get(url).set('If-None-Match', etag).expect(401);
    await request(app.getHttpServer()).get(url).set('If-None-Match', '*').expect(401);
  });

  it('/api/v1/projects/:projectId/exports should not access exports resource if not authenticated', async () => {
    await request(app.getHttpServer()).get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat`).expect(401);
  });

  it('/api/v1/projects/:projectId/exports should not access exports resource if not authorized', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
