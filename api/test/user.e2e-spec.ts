import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { getRepository } from 'typeorm';
import { ProjectLocale } from '../src/entity/project-locale.entity';
import { Project } from '../src/entity/project.entity';
import { Term } from '../src/entity/term.entity';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('UserController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let testingUser2: TestingUser;
  let testingUser3: TestingUser;
  let testProject: TestingProject;
  let termId: string = '';

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    testingUser2 = await signupTestUser(app, 'e2e-user2@test.com');
    testingUser3 = await signupTestUser(app, 'e2e-user3@test.com');

    testProject = await createTestProject(app, testingUser3);

    {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/terms`)
        .set('Authorization', `Bearer ${testingUser3.accessToken}`)
        .send({
          value: 'term.one',
        })
        .expect(201);
      termId = res.body.data.id;

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject.id}/translations`)
        .set('Authorization', `Bearer ${testingUser3.accessToken}`)
        .send({
          code: 'de_DE',
        })
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject.id}/translations/de_DE`)
        .set('Authorization', `Bearer ${testingUser3.accessToken}`)
        .send({
          termId,
          value: 'eins',
        })
        .expect(200);
    }
  });

  it('/api/v1/users/me (GET) should return requesting user info', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${testingUser.accessToken}`).expect(200);
  });

  it('/api/v1/users/me (PATCH) should update a users name or email', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'Updated Name ⛄ 😀👍 🍉你好',
      })
      .expect(200)
      .expect(res => {
        const payload = res.body.data;
        expect(payload.id).toBeDefined();
        expect(payload.email).toBeDefined();
        expect(payload.name).toEqual('Updated Name ⛄ 😀👍 🍉你好');
      });

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        email: 'updated.email@example.de',
      })
      .expect(200)
      .expect(res => {
        const payload = res.body.data;
        expect(payload.id).toBeDefined();
        expect(payload.name).toBeDefined();
        expect(payload.email).toEqual('updated.email@example.de');
      });

    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const payload = res.body.data;
        expect(payload.id).toBeDefined();
        expect(payload.name).toEqual('Updated Name ⛄ 😀👍 🍉你好');
        expect(payload.email).toEqual('updated.email@example.de');
      });

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My newly updated name',
        email: 'updated.email@example.com',
      })
      .expect(200)
      .expect(res => {
        const payload = res.body.data;
        expect(payload.id).toBeDefined();
        expect(payload.name).toEqual('My newly updated name');
        expect(payload.email).toEqual('updated.email@example.com');
      });

    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        const payload = res.body.data;
        expect(payload.id).toBeDefined();
        expect(payload.name).toEqual('My newly updated name');
        expect(payload.email).toEqual('updated.email@example.com');
      });
  });

  it('/api/v1/users/me (PATCH) should reject a malformed name or email on update', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .send({
        name: '',
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .send({
        email: 'updated.emailexample.com',
      })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .send({
        name: 'hellos',
        email: 'updatedemail@@example.com',
      })
      .expect(400);

    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .expect(200)
      .expect(res => {
        const payload = res.body.data;
        expect(payload.id).toBeDefined();
        expect(payload.name).toEqual('End to End Tester (e2e-user2@test.com)');
        expect(payload.email).toEqual('e2e-user2@test.com');
      });
  });

  it('/api/v1/users/me (DELETE) should not delete a users account if he is last project user and project has a team', async () => {
    // Add project user (non-admin)
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject.id}/invites`)
      .set('Authorization', `Bearer ${testingUser3.accessToken}`)
      .send({
        email: testingUser2.email,
        role: 'editor',
      })
      .expect(201);

    // Try to delete account
    await request(app.getHttpServer()).delete('/api/v1/users/me').set('Authorization', `Bearer ${testingUser3.accessToken}`).expect(422);

    // Account still exists
    await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${testingUser3.accessToken}`).expect(200);

    // Other user still has access
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .expect(200);

    // Now make him admin
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject.id}/users/${testingUser2.id}`)
      .set('Authorization', `Bearer ${testingUser3.accessToken}`)
      .send({
        role: 'admin',
      })
      .expect(200);

    // Now try to delete account
    await request(app.getHttpServer()).delete('/api/v1/users/me').set('Authorization', `Bearer ${testingUser3.accessToken}`).expect(204);

    // Account no longer exists exists
    await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${testingUser3.accessToken}`).expect(401);

    // Other user still has access
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject.id}`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .expect(200);
  });

  it('/api/v1/users/me (DELETE) should delete a users account, but keep the projects and related resources unaffected', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${testingUser3.accessToken}`).expect(200);

    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser3.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
      });

    await request(app.getHttpServer()).delete('/api/v1/users/me').set('Authorization', `Bearer ${testingUser3.accessToken}`).expect(204);

    await request(app.getHttpServer()).get('/api/v1/users/me').set('Authorization', `Bearer ${testingUser3.accessToken}`).expect(401);

    await request(app.getHttpServer()).get('/api/v1/projects').set('Authorization', `Bearer ${testingUser3.accessToken}`).expect(401);

    const project = await getRepository(Project).findOne(testProject.id);
    expect(project).toBeDefined();
    expect(project.id).toEqual(testProject.id);

    const term = await getRepository(Term).findOne(termId);
    expect(term).toBeDefined();
    expect(term.id).toEqual(termId);

    const projectLocales = await getRepository(ProjectLocale).find({
      where: { project: { id: testProject.id } },
      relations: ['locale'],
    });
    expect(projectLocales).toBeDefined();
    expect(projectLocales).toHaveLength(1);
    expect(projectLocales[0].locale.code).toEqual('de_DE');
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
