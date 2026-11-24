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

  it('should label the translation in another locale of a term that an import added', async () => {
    let labelId: string;
    let termLabelId: string;
    let termId: string;
    let term2Id: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ value: 'todo', color: '#202020' })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ value: 'done', color: '#808080' })
      .expect(201)
      .expect(res => (termLabelId = res.body.data.id));

    for (const code of ['en', 'de']) {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/translations`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({ code })
        .expect(201);
    }

    // An import adds the terms k and k2 and their translations in en only: they have no translation in de
    const fileToImport = (await jsonFlatExporter({
      translations: [
        { term: 'k', translation: 'Hello' },
        { term: 'k2', translation: 'Goodbye' },
      ],
    })) as string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=en&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(fileToImport), 'file')
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        termId = res.body.data.find(t => t.value === 'k').id;
        term2Id = res.body.data.find(t => t.value === 'k2').id;
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => expect(res.body.data).toEqual([]));

    // A label of the term goes to the new translation too, as when a translation is first saved
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${termLabelId}/terms/${termId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${termId}/translations/de`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        expect(res.body.data[0].termId).toEqual(termId);
        expect(res.body.data[0].value).toEqual('');
        expect(res.body.data[0].labels.map(l => [l.value, l.color]).sort()).toEqual([
          ['done', '#808080'],
          ['todo', '#202020'],
        ]);
      });

    // Labelling it again with either label leaves one of each
    for (const id of [labelId, termLabelId]) {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/labels/${id}/terms/${termId}/translations/de`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .expect(201);
    }

    // The label of a new translation that the term already has is added once
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${termLabelId}/terms/${term2Id}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${termLabelId}/terms/${term2Id}/translations/de`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(201);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const translation = res.body.data.find(t => t.termId === termId);
        expect(translation).toHaveExactProperties(['termId', 'value', 'labels', 'date']);
        expect(translation.value).toEqual('');
        expect(translation.labels.map(l => [l.value, l.color]).sort()).toEqual([
          ['done', '#808080'],
          ['todo', '#202020'],
        ]);
        const translation2 = res.body.data.find(t => t.termId === term2Id);
        expect(translation2.value).toEqual('');
        expect(translation2.labels.map(l => l.value)).toEqual(['done']);
      });

    // The en translation keeps its value and gets no label of de
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/en`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(2);
        const translation = res.body.data.find(t => t.termId === termId);
        expect(translation.value).toEqual('Hello');
        expect(translation.labels.map(l => l.value)).toEqual(['done']);
      });
  });

  it('should keep both the value and the label when a first save and a first label of a translation run at once', async () => {
    let labelId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ value: 'todo', color: '#202020' })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

    for (const code of ['en', 'de']) {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/translations`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({ code })
        .expect(201);
    }

    // The imported terms have no translation in de: the save and the label both add it
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}`);
    const fileToImport = (await jsonFlatExporter({ translations: keys.map(term => ({ term, translation: 'Hello' })) })) as string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/imports?locale=en&format=jsonflat`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .attach('file', Buffer.from(fileToImport), 'file')
      .expect(200);

    const terms = (
      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .expect(200)
    ).body.data;

    // supertest starts and closes a server per request on a server that is not listening, so two
    // concurrent requests can close it under each other (ECONNRESET). Listen once for the whole loop;
    // app.close() in afterEach closes it.
    const server = app.getHttpServer();
    if (!server.listening) {
      await new Promise<void>(resolve => server.listen(0, () => resolve()));
    }

    for (const term of terms) {
      const [saved, labelled] = await Promise.all([
        request(app.getHttpServer())
          .patch(`/api/v1/projects/${testProject.id}/translations/de`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`)
          .send({ termId: term.id, value: 'Hallo' }),
        request(app.getHttpServer())
          .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${term.id}/translations/de`)
          .set('Authorization', `Bearer ${testingUser.accessToken}`),
      ]);
      expect([saved.status, labelled.status]).toEqual([200, 201]);
    }

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(keys.length);
        for (const translation of res.body.data) {
          expect(translation.value).toEqual('Hallo');
          expect(translation.labels.map(l => l.value)).toEqual(['todo']);
        }
      });
  });

  it('should not label the translation of a term of another project', async () => {
    let labelId: string;
    let otherTermId: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ value: 'todo', color: '#202020' })
      .expect(201)
      .expect(res => (labelId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/translations`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ code: 'de' })
      .expect(201);

    const otherProject = await createTestProject(app, testingUser);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${otherProject.id}/terms`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ value: 'k' })
      .expect(201)
      .expect(res => (otherTermId = res.body.data.id));

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/labels/${labelId}/terms/${otherTermId}/translations/de`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}/translations/de`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => expect(res.body.data).toEqual([]));
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

    await request(app.getHttpServer()).get(`/api/v1/projects/${testProject.id}/labels`).expect(401);

    await request(app.getHttpServer()).post(`/api/v1/projects/${testProject.id}/labels`).expect(401);

    await request(app.getHttpServer()).patch(`/api/v1/projects/${testProject.id}/labels/${labelId}`).expect(401);

    await request(app.getHttpServer()).delete(`/api/v1/projects/${testProject.id}/labels/${labelId}`).expect(401);

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
