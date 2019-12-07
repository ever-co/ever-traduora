import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { jsonFlatExporter } from '../src/formatters/jsonflat';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('ImportController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let anotherUser: TestingUser;
  let testProject: TestingProject;

  let termOneId: string;
  let termTwoId: string;
  let jsonFlat100: string;
  let jsonFlatWithNewTerms: string;
  let norwayTranslations: string;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    anotherUser = await signupTestUser(app, 'another-user@test.com');
    testProject = await createTestProject(app, testingUser);

    jsonFlat100 = (await jsonFlatExporter({
      translations: new Array(100).fill(0).map((_, index) => ({ term: `term.${index}`, translation: `some ${index}` })),
    })) as string;

    jsonFlatWithNewTerms = (await jsonFlatExporter({
      translations: [
        {
          term: 'term.one',
          translation: 'eins?',
        },
        {
          term: 'term.three',
          translation: 'drei ⛄ 😀👍 🍉你好',
        },
      ],
    })) as string;

    norwayTranslations = (await jsonFlatExporter({
      translations: [
        {
          term: 'term.one',
          translation: 'some one',
        },
        {
          term: 'term.two',
          translation: 'some two',
        },
      ],
    })) as string;

    // Pre-existing Terms
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
          value: 'deux',
        })
        .expect(200);
    }
  });

  it('/api/v1/projects/:projectId/imports (POST) should automatically create locale for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=nb_NO&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(norwayTranslations), 'file')
      .expect(200)
      .expect({
        data: {
          terms: {
            added: 0,
            skipped: 2,
          },
          translations: {
            upserted: 2,
          },
        },
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/nb_NO`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'some one',
          tags: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'some two',
          tags: [],
        });
      });

    // Ensure did not affect other locales

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'eins',
          tags: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'zwei',
          tags: [],
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'un',
          tags: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'deux',
          tags: [],
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const termValues = res.body.data.map(t => t.value);
        expect(termValues).toContainEqual('term.one');
        expect(termValues).toContainEqual('term.two');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        const localeCodes = res.body.data.map(t => t.locale.code);
        expect(localeCodes).toContainEqual('de_DE');
        expect(localeCodes).toContainEqual('fr');
        expect(localeCodes).toContainEqual('nb_NO');
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should replace/add translations if locale already exists', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(jsonFlatWithNewTerms), 'file')
      .expect(200)
      .expect({
        data: {
          terms: {
            added: 1,
            skipped: 1,
          },
          translations: {
            upserted: 2,
          },
        },
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'eins?',
          tags: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'zwei',
          tags: [],
        });
        const termValues = res.body.data.map(t => t.value);
        expect(termValues).toContainEqual('drei ⛄ 😀👍 🍉你好');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'un',
          tags: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'deux',
          tags: [],
        });
      });
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        const termValues = res.body.data.map(t => t.value);
        expect(termValues).toContainEqual('term.one');
        expect(termValues).toContainEqual('term.two');
        expect(termValues).toContainEqual('term.three');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const localeCodes = res.body.data.map(t => t.locale.code);
        expect(localeCodes).toContainEqual('de_DE');
        expect(localeCodes).toContainEqual('fr');
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should fail import if would exceed plan limits', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=es_MX&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(jsonFlat100), 'file')
      .expect(402);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'eins',
          tags: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'zwei',
          tags: [],
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        // Remove date fields for comparison
        res.body.data.forEach(x => delete x.date);
        expect(res.body.data).toContainEqual({
          termId: termOneId,
          value: 'un',
          tags: [],
        });
        expect(res.body.data).toContainEqual({
          termId: termTwoId,
          value: 'deux',
          tags: [],
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const termValues = res.body.data.map(t => t.value);
        expect(termValues).toContainEqual('term.one');
        expect(termValues).toContainEqual('term.two');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const localeCodes = res.body.data.map(t => t.locale.code);
        expect(localeCodes).toContainEqual('de_DE');
        expect(localeCodes).toContainEqual('fr');
      });
  });

  it('/api/v1/projects/:projectId/imports (POST) should not import if params are missing or invalid', async () => {
    // Missing payload
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=xliff12`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400);

    // Missing locale
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?format=xliff12`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from('<xml />'), 'file')
      .expect(400);

    // Unknown locale
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_MX&format=xliff12`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from('<xml />'), 'file')
      .expect(404);
  });

  it('/api/v1/projects/:projectId/imports should not access imports resource if not authenticated', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports`)
      .attach('file', Buffer.from('<xml />'), 'file')
      .expect(401);
  });

  it('/api/v1/projects/:projectId/imports should not access imports resource if not authorized', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=xliff12`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .attach('file', Buffer.from('<xml />'), 'file')
      .expect(404);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
