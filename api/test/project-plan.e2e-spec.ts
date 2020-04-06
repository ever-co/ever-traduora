import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { jsonFlatExporter } from '../src/formatters/jsonflat';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('PlansController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let anotherUser: TestingUser;
  let testProject: TestingProject;
  let termId: string;

  beforeAll(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    anotherUser = await signupTestUser(app, 'another-user@test.com');
    testProject = await createTestProject(app, testingUser);
  });

  it('/v1/projects/:projectId/plan (GET) should return the current project plan', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/plan`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['name', 'code', 'maxStrings', 'date']);
        expect(res.body.data.code).toEqual('default');
        expect(res.body.data.maxStrings).toEqual(100);
      });
  });

  it('adding terms should count towards the project plan', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(0);
        expect(res.body.data.localesCount).toEqual(0);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => (termId = res.body.data.id));

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(1);
        expect(res.body.data.localesCount).toEqual(0);
      });
  });

  it('removing terms should count towards the project plan', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(1);
        expect(res.body.data.localesCount).toEqual(0);
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/terms/${termId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(0);
        expect(res.body.data.localesCount).toEqual(0);
      });
  });

  it('adding locales should count towards the project plan', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(0);
        expect(res.body.data.localesCount).toEqual(0);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(0);
        expect(res.body.data.localesCount).toEqual(1);
      });
  });

  it('removing locales should count towards the project plan', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(0);
        expect(res.body.data.localesCount).toEqual(1);
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(0);
        expect(res.body.data.localesCount).toEqual(0);
      });
  });

  it('should not be able to add terms if would exceed current plan quota', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=es_MX&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach(
        'file',
        Buffer.from(
          (await jsonFlatExporter({
            translations: new Array(99).fill(0).map((_, index) => ({ term: `term.${index}`, translation: `some ${index}` })),
          })) as string,
        ),
        'file',
      )
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(100);
        expect(res.body.data.localesCount).toEqual(1);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two',
      })
      .expect(402);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(100);
        expect(res.body.data.localesCount).toEqual(1);
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/translations/es_MX`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);
  });

  it('should not be able to add locales if would exceed current plan quota', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.termsCount).toEqual(100);
        expect(res.body.data.localesCount).toEqual(0);
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'nb_NO',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(402);
  });

  it('/v1/projects/:projectId/plan should not access plan resource if not authenticated', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/plan`)
      .expect(401);
  });

  it('/v1/projects/:projectId/plan should not access plan resource if not authorized', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/plan`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);
  });

  afterAll(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
