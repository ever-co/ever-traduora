import { Connection } from 'typeorm';
import './util';

import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { createAndMigrateApp, signupTestUser, TestingUser, createTestProject, TestingProject } from './util';

describe('TermController (e2e)', () => {
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

  it('/api/v1/projects/:projectId/terms (POST) should create terms for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'value', 'context', 'labels', 'date']);
        expect(res.body.data.labels).toEqual([]);
      });
  });

  it('/api/v1/projects/:projectId/terms (POST) should create terms with context for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
        context: 'Context one',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'value', 'context', 'labels', 'date']);
        expect(res.body.data.context).toEqual('Context one');
        expect(res.body.data.labels).toEqual([]);
      });
  });

  it('/api/v1/projects/:projectId/terms (GET) should find terms for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'value', 'context', 'labels', 'date']);
      });
  });

  it('/api/v1/projects/:projectId/terms (GET) should return terms in lexical order', async () => {
    const input = ['app.login', 'should be last', 'app.logout', '2 goes second', 'app.exit', 'menu.start', 'a term', '1 goes first'];
    const expected = ['1 goes first', '2 goes second', 'a term', 'app.exit', 'app.login', 'app.logout', 'menu.start', 'should be last'];

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
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(expected.length);
        expect(res.body.data.map(t => t.value)).toEqual(expected);
      });
  });

  it('/api/v1/projects/:projectId/terms/:termId (PATCH) should update term by id', async () => {
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
        context: 'Context one',
      })
      .expect(201)
      .expect(res => {
        termId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/terms/${termId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two',
        context: 'Context two',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'value', 'context', 'labels', 'date']);
        expect(res.body.data.id).toEqual(termId);
        expect(res.body.data.value).toEqual('term.two');
        expect(res.body.data.context).toEqual('Context two');
      });
  });

  it('/api/v1/projects/:projectId/terms/:termId (PATCH) should accept terms with utf-8 encoding', async () => {
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => {
        termId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/terms/${termId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two őúüöá 😀👍🍉你好',
        context: 'Context őúüöá 😀👍🍉你好',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'value', 'context', 'labels', 'date']);
        expect(res.body.data.id).toEqual(termId);
        expect(res.body.data.value).toEqual('term.two őúüöá 😀👍🍉你好');
        expect(res.body.data.context).toEqual('Context őúüöá 😀👍🍉你好');
      });
  });

  it('/api/v1/projects/:projectId/terms/:termId (DELETE) should delete term by id', async () => {
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => {
        termId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/terms/${termId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(0);
      });
  });

  it('/api/v1/projects/:projectId/terms should not access terms resource if not authenticated', async () => {
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => {
        termId = res.body.data.id;
      });

    await request(app.getHttpServer()).post(`/api/v1/projects/${testProject.id}/terms`).expect(401);

    await request(app.getHttpServer()).get(`/api/v1/projects/${testProject.id}/terms/`).expect(401);

    await request(app.getHttpServer()).patch(`/api/v1/projects/${testProject.id}/terms/${termId}`).expect(401);

    await request(app.getHttpServer()).delete(`/api/v1/projects/${testProject.id}/terms/${termId}`).expect(401);
  });

  it('/api/v1/projects/:projectId/terms should not access terms resource if not authorized', async () => {
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => {
        termId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        value: 'should not persist',
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/terms/${termId}`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        value: 'should not persist',
      })
      .expect(404);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/terms/${termId}`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
