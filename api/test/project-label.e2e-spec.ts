import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection } from 'typeorm';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';
import { jsonFlatExporter } from '../src/formatters/jsonflat';

describe('ProjectLabelController (e2e)', () => {
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

  it('/api/v1/projects/:projectId/labels (POST) should create labels for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
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

  it('/api/v1/projects/:projectId/labels (POST) should accept labels with utf-8 encoding', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
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

  it('/api/v1/projects/:projectId/labels (GET) should find labels for project', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'done 😀👍',
        color: '#808080',
      })
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'value', 'color']);
        expect(res.body.data.map(t => [t.value, t.color])).toEqual([
          ['done 😀👍', '#808080'],
          ['todo', '#202020'],
        ]);
      });
  });

  it('/api/v1/projects/:projectId/labels/:labelId (PATCH) should update a label by id', async () => {
    let labelId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'done',
        color: '#808080',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/labels/${labelId}`)
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
      .get(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'value', 'color']);
        expect(res.body.data.map(t => [t.value, t.color])).toEqual([
          ['done', '#808080'],
          ['wip', '#aaffaa'],
        ]);
      });
  });

  it('/api/v1/projects/:projectId/labels/:labelId (DELETE) should labels by id', async () => {
    let labelId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'done',
        color: '#808080',
      })
      .expect(201);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/labels/${labelId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'value', 'color']);
        expect(res.body.data.map(t => [t.value, t.color])).toEqual([['done', '#808080']]);
      });
  });

  it('/api/v1/projects/:projectId/labels/:labelId/terms/:termId (POST) should label a term', async () => {
    let labelId: string;
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => (termId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data[0].labels).toHaveLength(1);
        expect(res.body.data[0].labels[0].value).toEqual('todo');
        expect(res.body.data[0].labels[0].color).toEqual('#202020');
      });
  });

  it('should propagate term labels to translations whenever a term, translation or project locale is created', async () => {
    let labelId: string;
    let labelId2: string;
    let termId: string;
    let termId2: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'done',
        color: '#808080',
      })
      .expect(201)
      .expect(res => (labelId2 = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.one',
      })
      .expect(201)
      .expect(res => (termId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'term.two',
      })
      .expect(201)
      .expect(res => (termId2 = res.body.data.id));

    // Label term one
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    // Term should have label
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data[0].labels).toHaveLength(1);
        expect(res.body.data[0].labels[0].value).toEqual('todo');
        expect(res.body.data[0].labels[0].color).toEqual('#202020');
      });

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

    // Translation should have label from term copied over
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        const translation = res.body.data.find(v => v.termId === termId);
        expect(translation.value).toEqual('eins');
        expect(translation.labels).toHaveLength(1);
        expect(translation.labels[0].value).toEqual('todo');
        expect(translation.labels[0].color).toEqual('#202020');

        const translationOther = res.body.data.find(v => v.termId === termId2);
        expect(translationOther.value).toEqual('');
        expect(translationOther.labels).toHaveLength(0);
      });

    // Unlabel translation
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        const translation = res.body.data.find(v => v.termId === termId);
        expect(translation.termId).toEqual(termId);
        expect(translation.value).toEqual('eins');
      });

    // Try to import
    const fileToImport = (await jsonFlatExporter({
      translations: [
        { term: 'term.one', translation: 'Hello' },
        { term: 'term.two', translation: 'Goodbye' },
      ],
    })) as string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=de_DE&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(fileToImport), 'file')
      .expect(200);

    // Translation should have label from term copied over
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        const translation = res.body.data.find(v => v.termId === termId);
        expect(translation.value).toEqual('Hello');
        expect(translation.labels).toHaveLength(1);
        expect(translation.labels[0].value).toEqual('todo');
        expect(translation.labels[0].color).toEqual('#202020');

        const translationOther = res.body.data.find(v => v.termId === termId2);
        expect(translationOther.value).toEqual('Goodbye');
        expect(translationOther.labels).toHaveLength(0);
      });

    // Label term two
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId2}/terms/${termId2}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=nb_NO&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(fileToImport), 'file')
      .expect(200);

    // Translation should have label from term copied over
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        const translation = res.body.data.find(v => v.termId === termId);
        expect(translation.value).toEqual('Hello');
        expect(translation.labels).toHaveLength(1);
        expect(translation.labels[0].value).toEqual('todo');
        expect(translation.labels[0].color).toEqual('#202020');

        const translationOther = res.body.data.find(v => v.termId === termId2);
        expect(translationOther.value).toEqual('Goodbye');
        expect(translationOther.labels).toHaveLength(1);
        expect(translationOther.labels[0].value).toEqual('done');
        expect(translationOther.labels[0].color).toEqual('#808080');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/nb_NO`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'labels', 'date']);

        const translation = res.body.data.find(v => v.termId === termId);
        expect(translation.value).toEqual('Hello');
        expect(translation.labels).toHaveLength(1);
        expect(translation.labels[0].value).toEqual('todo');
        expect(translation.labels[0].color).toEqual('#202020');

        const translationOther = res.body.data.find(v => v.termId === termId2);
        expect(translationOther.value).toEqual('Goodbye');
        expect(translationOther.labels).toHaveLength(1);
        expect(translationOther.labels[0].value).toEqual('done');
        expect(translationOther.labels[0].color).toEqual('#808080');
      });
  });

  it('/api/v1/projects/:projectId/labels/:labelId/terms/:termId (DELETE) should unlabel a term', async () => {
    let labelId: string;
    let term1Id: string;
    let term2Id: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

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
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${term1Id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${term2Id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        expect(res.body.data[0].labels).toHaveLength(1);
        expect(res.body.data[0].labels[0].value).toEqual('todo');
        expect(res.body.data[0].labels[0].color).toEqual('#202020');

        expect(res.body.data[1].labels).toHaveLength(1);
        expect(res.body.data[1].labels[0].value).toEqual('todo');
        expect(res.body.data[1].labels[0].color).toEqual('#202020');
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${term1Id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        expect(res.body.data[0].labels).toHaveLength(0);

        expect(res.body.data[1].labels).toHaveLength(1);
        expect(res.body.data[1].labels[0].value).toEqual('todo');
        expect(res.body.data[1].labels[0].color).toEqual('#202020');
      });
  });

  it('/api/v1/projects/:projectId/labels/:labelId/terms/:termId/translations/:localeCode (POST) should label a translation', async () => {
    let labelId: string;
    let termId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

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
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        expect(res.body.data[0].termId).toEqual(termId);
        expect(res.body.data[0].value).toEqual('eins');
        expect(res.body.data[0].labels[0].value).toEqual('todo');
        expect(res.body.data[0].labels[0].color).toEqual('#202020');
      });
  });

  it('/api/v1/projects/:projectId/labels/:labelId/terms/:termId/translations/:localeCode (DELETE) should unlabel a translation', async () => {
    let labelId: string;
    let term1Id: string;
    let term2Id: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

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
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${term1Id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${term2Id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        const translation1 = res.body.data.find(d => d.termId === term1Id);
        expect(translation1).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        expect(translation1.termId).toEqual(term1Id);
        expect(translation1.value).toEqual('eins');
        expect(translation1.labels[0].value).toEqual('todo');
        expect(translation1.labels[0].color).toEqual('#202020');

        const translation2 = res.body.data.find(d => d.termId === term2Id);
        expect(translation2).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        expect(translation2.termId).toEqual(term2Id);
        expect(translation2.value).toEqual('zwei');
        expect(translation2.labels[0].value).toEqual('todo');
        expect(translation2.labels[0].color).toEqual('#202020');
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${term1Id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de_DE`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);

        const translation1 = res.body.data.find(d => d.termId === term1Id);
        expect(translation1).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        expect(translation1.termId).toEqual(term1Id);
        expect(translation1.value).toEqual('eins');
        expect(translation1.labels).toHaveLength(0);

        const translation2 = res.body.data.find(d => d.termId === term2Id);
        expect(translation2).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        expect(translation2.termId).toEqual(term2Id);
        expect(translation2.value).toEqual('zwei');
        expect(translation2.labels[0].value).toEqual('todo');
        expect(translation2.labels[0].color).toEqual('#202020');
      });
  });

  it('/api/v1/projects/:projectId/labels should not access terms resource if not authenticated or authorized', async () => {
    let labelId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        value: 'todo',
        color: '#202020',
      })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/labels/${labelId}`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        value: 'done',
        color: '#808080',
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/labels`)
      .expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/labels/${labelId}`)
      .expect(401);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject.id}/labels/${labelId}`)
      .expect(401);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/labels`)
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
