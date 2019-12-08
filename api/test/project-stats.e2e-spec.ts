import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('ProjectStatsController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let anotherUser: TestingUser;
  let testProject: TestingProject;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    anotherUser = await signupTestUser(app, 'another-user@test.com');
    testProject = await createTestProject(app, testingUser);
  });

  it('/api/v1/projects/:projectId/stats (GET) should get the project locale stats', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/stats`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toEqual({
          projectStats: {
            progress: 0,
            translated: 0,
            total: 0,
          },
          localeStats: {},
        });
      });

    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(res => {
        termId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/stats`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toEqual({
          projectStats: {
            progress: 0,
            translated: 0,
            total: 1,
          },
          localeStats: {},
        });
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/stats`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toEqual({
          projectStats: {
            progress: 0,
            translated: 0,
            total: 1,
          },
          localeStats: {
            de_DE: {
              progress: 0,
              translated: 0,
              total: 1,
            },
          },
        });
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId,
        value: 'eins',
      })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/stats`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toEqual({
          projectStats: {
            progress: 1,
            translated: 1,
            total: 1,
          },
          localeStats: {
            de_DE: {
              progress: 1,
              total: 1,
              translated: 1,
            },
          },
        });
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        code: 'fr',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/stats`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toEqual({
          projectStats: {
            progress: 0.5,
            translated: 1,
            total: 2,
          },
          localeStats: {
            de_DE: {
              progress: 1,
              total: 1,
              translated: 1,
            },
            fr: {
              progress: 0,
              total: 1,
              translated: 0,
            },
          },
        });
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two',
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/stats`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toEqual({
          projectStats: {
            progress: 0.25,
            translated: 1,
            total: 4,
          },
          localeStats: {
            de_DE: {
              progress: 0.5,
              total: 2,
              translated: 1,
            },
            fr: {
              progress: 0,
              total: 2,
              translated: 0,
            },
          },
        });
      });
  });

  it('/api/v1/projects/:projectId/translations should not access stats resource if not authenticated', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/stats`)
      .expect(401);
  });

  it('/api/v1/projects/:projectId/translations should not access stats resource if not authorized', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/stats`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        code: 'bad',
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/stats`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
