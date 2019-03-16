import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';
import { propertiesParser } from '../src/formatters/properties';

describe('ExportController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let anotherUser: TestingUser;
  let testProject: TestingProject;

  let termOneId: string;
  let termTwoId: string;

  beforeAll(async () => {
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
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        expect(Object.keys(parsed)).toHaveLength(2);
        expect(parsed['term.two']).toEqual('zwei');
        expect(parsed['term.one']).toEqual('eins');
      });
  });

  it('/api/v1/projects/:projectId/exports (GET) should export translation with utf-8 characters in various formats', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=fr&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const parsed = JSON.parse(Buffer.from(res.body).toString('utf-8'));
        expect(Object.keys(parsed)).toHaveLength(2);
        expect(parsed['term.two']).toEqual('deux ⛄ 😀👍 🍉你好');
        expect(parsed['term.one']).toEqual('un');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=fr&format=properties`)
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
      .get(`/api/v1/projects/${testProject.id}/exports?locale=es_CR&format=jsonflat`)
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
      .get(`/api/v1/projects/${testProject.id}/exports?locale=dd_DD&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(404);

    // unknown format
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=flatjson`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(400);
  });

  it('/api/v1/projects/:projectId/exports?format=jsonflat (GET) should not export if locale does not exist for project', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=es&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(404);
  });

  it('/api/v1/projects/:projectId/exports should not access exports resource if not authenticated', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat`)
      .expect(401);
  });

  it('/api/v1/projects/:projectId/exports should not access exports resource if not authorized', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/exports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);
  });

  afterAll(async () => {
    await app.close();
  });
});
