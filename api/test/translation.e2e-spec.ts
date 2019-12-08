import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('TranslationController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let anotherUser: TestingUser;
  let testProject: TestingProject;
  let termId: string;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    anotherUser = await signupTestUser(app, 'another-user@test.com');
    testProject = await createTestProject(app, testingUser);

    {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          value: 'term.one',
        });
      termId = res.body.data.id;
    }
  });

  it('/api/v1/projects/:projectId/translations (POST) should create project locale', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'locale', 'stats', 'date']);
        expect(res.body.data.locale).toHaveExactProperties(['code', 'region', 'language']);
        expect(res.body.data.stats).toHaveExactProperties(['progress', 'translated', 'total']);
        expect(res.body.data.stats.progress).toEqual(0);
        expect(res.body.data.stats.translated).toEqual(0);
        expect(res.body.data.stats.total).toEqual(1);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'locale', 'stats', 'date']);
        expect(res.body.data.locale).toHaveExactProperties(['code', 'region', 'language']);
        expect(res.body.data.stats).toHaveExactProperties(['progress', 'translated', 'total']);
      });
  });

  it('/api/v1/projects/:projectId/translations (POST) should fail if locale already exists for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(409);
  });

  it('/api/v1/projects/:projectId/translations (POST) should not create project locale if missing/invalid data or locale not known', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'dd_DD',
      })
      .expect(404);
  });

  it('/api/v1/projects/:projectId/translations (GET) should find project locales', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        expect(res.body.data[0]).toHaveExactProperties(['id', 'locale', 'stats', 'date']);

        expect(res.body.data[0]).toHaveProperty('locale.code');
        expect(res.body.data[0].locale.code).toEqual('de_DE');
        expect(res.body.data[1].locale.code).toEqual('fr');
      });
  });

  it('/api/v1/projects/:projectId/translations (GET) should update the project locale stats', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0].locale.code).toEqual('de_DE');
        expect(res.body.data[0].stats.progress).toEqual(0);
        expect(res.body.data[0].stats.total).toEqual(1);
        expect(res.body.data[0].stats.translated).toEqual(0);

        expect(res.body.data[1].locale.code).toEqual('fr');
        expect(res.body.data[1].stats.progress).toEqual(0);
        expect(res.body.data[1].stats.total).toEqual(1);
        expect(res.body.data[1].stats.translated).toEqual(0);
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId,
        value: 'eins',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['termId', 'value', 'date']);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0].locale.code).toEqual('de_DE');
        expect(res.body.data[0].stats.progress).toEqual(1);
        expect(res.body.data[0].stats.total).toEqual(1);
        expect(res.body.data[0].stats.translated).toEqual(1);

        expect(res.body.data[1].locale.code).toEqual('fr');
        expect(res.body.data[1].stats.progress).toEqual(0);
        expect(res.body.data[1].stats.total).toEqual(1);
        expect(res.body.data[1].stats.translated).toEqual(0);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two',
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0].locale.code).toEqual('de_DE');
        expect(res.body.data[0].stats.progress).toEqual(0.5);
        expect(res.body.data[0].stats.total).toEqual(2);
        expect(res.body.data[0].stats.translated).toEqual(1);

        expect(res.body.data[1].locale.code).toEqual('fr');
        expect(res.body.data[1].stats.progress).toEqual(0);
        expect(res.body.data[1].stats.total).toEqual(2);
        expect(res.body.data[1].stats.translated).toEqual(0);
      });
  });

  it('/api/v1/projects/:projectId/translations/:localeCode (PATCH) should update translation for existing terms', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId,
        value: 'eins',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['termId', 'value', 'date']);
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId,
        value: 'un',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['termId', 'value', 'date']);
      });
  });

  it('/api/v1/projects/:projectId/translations/:localeCode (PATCH) should accept translations with utf-8 characters', async () => {
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
        termId,
        value: 'őúüöá',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['termId', 'value', 'date']);
        expect(res.body.data.value).toEqual('őúüöá');
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId,
        value: 'őúüöá 😀👍🍉你好',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['termId', 'value', 'date']);
        expect(res.body.data.value).toEqual('őúüöá 😀👍🍉你好');
      });
  });

  it('/api/v1/projects/:projectId/translations/:localeCode (PATCH) should fail to update translation if term or locale not exists', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id.slice(0, 16)}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId,
        value: 'eins',
      })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId: termId.slice(0, 16),
        value: 'un',
      })
      .expect(404);
  });

  it('/api/v1/projects/:projectId/translations/:localeCode (GET) should find project translation for locale', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId,
        value: 'eins',
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId,
        value: 'un',
      })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'date']);
        expect(res.body.data[0].termId).toEqual(termId);
        expect(res.body.data[0].value).toEqual('eins');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'date']);
        expect(res.body.data[0].termId).toEqual(termId);
        expect(res.body.data[0].value).toEqual('un');
      });
  });

  it('/api/v1/projects/:projectId/translations/:localeCode (DELETE) should delete project locale', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/fr`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200);
  });

  it('/api/v1/projects/:projectId/translations should not access translations resource if not authenticated', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .expect(401);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .expect(401);
  });

  it('/api/v1/projects/:projectId/translations should not access translations resource if not authorized', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        code: 'bad',
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        termId,
        value: 'should not persist',
      })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
