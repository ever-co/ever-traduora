import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('ProjectTagController (e2e)', () => {
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

  it('/api/v1/projects/:projectId/tags (POST) should create tags for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'value', 'color']);
      });
  });

  it('/api/v1/projects/:projectId/tags (POST) should accept tags with utf-8 encoding', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two őúüöá 😀👍🍉你好',
        color: '#202020',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data.value).toEqual('term.two őúüöá 😀👍🍉你好');
      });
  });

  it('/api/v1/projects/:projectId/tags (GET) should find tags for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'done 😀👍',
        color: '#808080',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'value', 'color']);
        expect(res.body.data.map(t => [t.value, t.color])).toEqual([['done 😀👍', '#808080'], ['todo', '#202020']]);
      });
  });

  it('/api/v1/projects/:projectId/tags/:tagId (PATCH) should update a tag by id', async () => {
    let tagId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (tagId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'done',
        color: '#808080',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/tags/${tagId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'wip',
        color: '#aaffaa',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'value', 'color']);
        expect(res.body.data.color).toEqual('#aaffaa');
        expect(res.body.data.value).toEqual('wip');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'value', 'color']);
        expect(res.body.data.map(t => [t.value, t.color])).toEqual([['done', '#808080'], ['wip', '#aaffaa']]);
      });
  });

  it('/api/v1/projects/:projectId/tags/:tagId (DELETE) should tags by id', async () => {
    let tagId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (tagId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'done',
        color: '#808080',
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/tags/${tagId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'value', 'color']);
        expect(res.body.data.map(t => [t.value, t.color])).toEqual([['done', '#808080']]);
      });
  });

  it('/api/v1/projects/:projectId/tags/:tagId/terms/:termId (POST) should tag a term', async () => {
    let tagId: string;
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (tagId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => (termId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags/${tagId}/terms/${termId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms?includeTags=true`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data[0].tags).toHaveLength(1);
        expect(res.body.data[0].tags[0].value).toEqual('todo');
        expect(res.body.data[0].tags[0].color).toEqual('#202020');
      });
  });

  it('/api/v1/projects/:projectId/tags/:tagId/terms/:termId (DELETE) should untag a term', async () => {
    let tagId: string;
    let term1Id: string;
    let term2Id: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (tagId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => (term1Id = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two',
      })
      .expect(201)
      .expect(res => (term2Id = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags/${tagId}/terms/${term1Id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags/${tagId}/terms/${term2Id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms?includeTags=true`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        expect(res.body.data[0].tags).toHaveLength(1);
        expect(res.body.data[0].tags[0].value).toEqual('todo');
        expect(res.body.data[0].tags[0].color).toEqual('#202020');

        expect(res.body.data[1].tags).toHaveLength(1);
        expect(res.body.data[1].tags[0].value).toEqual('todo');
        expect(res.body.data[1].tags[0].color).toEqual('#202020');
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/tags/${tagId}/terms/${term1Id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms?includeTags=true`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        expect(res.body.data[0].tags).toHaveLength(0);

        expect(res.body.data[1].tags).toHaveLength(1);
        expect(res.body.data[1].tags[0].value).toEqual('todo');
        expect(res.body.data[1].tags[0].color).toEqual('#202020');
      });
  });

  it('/api/v1/projects/:projectId/tags/:tagId/terms/:termId/translations/:localeCode (POST) should tag a translation', async () => {
    let tagId: string;
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (tagId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => (termId = res.body.data.id));

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
        value: 'eins',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags/${tagId}/terms/${termId}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'tags', 'date']);
        expect(res.body.data[0].termId).toEqual(termId);
        expect(res.body.data[0].value).toEqual('eins');
        expect(res.body.data[0].tags[0].value).toEqual('todo');
        expect(res.body.data[0].tags[0].color).toEqual('#202020');
      });
  });

  it('/api/v1/projects/:projectId/tags/:tagId/terms/:termId/translations/:localeCode (DELETE) should untag a translation', async () => {
    let tagId: string;
    let term1Id: string;
    let term2Id: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (tagId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => (term1Id = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two',
      })
      .expect(201)
      .expect(res => (term2Id = res.body.data.id));

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
        termId: term1Id,
        value: 'eins',
      })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        termId: term2Id,
        value: 'zwei',
      })
      .expect(200);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags/${tagId}/terms/${term1Id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags/${tagId}/terms/${term2Id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        const translation1 = res.body.data.find(d => d.termId === term1Id);
        expect(translation1).toHaveExactProperties(['termId', 'value', 'tags', 'date']);
        expect(translation1.termId).toEqual(term1Id);
        expect(translation1.value).toEqual('eins');
        expect(translation1.tags[0].value).toEqual('todo');
        expect(translation1.tags[0].color).toEqual('#202020');

        const translation2 = res.body.data.find(d => d.termId === term2Id);
        expect(translation2).toHaveExactProperties(['termId', 'value', 'tags', 'date']);
        expect(translation2.termId).toEqual(term2Id);
        expect(translation2.value).toEqual('zwei');
        expect(translation2.tags[0].value).toEqual('todo');
        expect(translation2.tags[0].color).toEqual('#202020');
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/tags/${tagId}/terms/${term1Id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        const translation1 = res.body.data.find(d => d.termId === term1Id);
        expect(translation1).toHaveExactProperties(['termId', 'value', 'tags', 'date']);
        expect(translation1.termId).toEqual(term1Id);
        expect(translation1.value).toEqual('eins');
        expect(translation1.tags).toHaveLength(0);

        const translation2 = res.body.data.find(d => d.termId === term2Id);
        expect(translation2).toHaveExactProperties(['termId', 'value', 'tags', 'date']);
        expect(translation2.termId).toEqual(term2Id);
        expect(translation2.value).toEqual('zwei');
        expect(translation2.tags[0].value).toEqual('todo');
        expect(translation2.tags[0].color).toEqual('#202020');
      });
  });

  it('/api/v1/projects/:projectId/tags should not access terms resource if not authenticated or authorized', async () => {
    let tagId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (tagId = res.body.data.id));

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/tags/${tagId}`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        value: 'done',
        color: '#808080',
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/tags`)
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/tags`)
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/tags/${tagId}`)
      .expect(401);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/tags/${tagId}`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/tags`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'value', 'color']);
        expect(res.body.data.map(t => [t.value, t.color])).toEqual([['todo', '#202020']]);
      });
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
