import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import './util';
import { createAndMigrateApp, signupTestUser, TestingUser } from './util';

describe('ProjectController (e2e)', () => {
  let app: INestApplication;
  let testingUser: TestingUser;
  let anotherUser: TestingUser;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser = await signupTestUser(app);
    anotherUser = await signupTestUser(app, 'another-user@test.com');
  });

  it('/api/v1/projects (POST) should create a project and assign the user as admin', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'role', 'description', 'termsCount', 'localesCount', 'date']);
        expect(res.body.data.name).toEqual('My first project');
        expect(res.body.data.description).toBeNull();
        expect(res.body.data.role).toEqual('admin');
        expect(res.body.data.termsCount).toEqual(0);
        expect(res.body.data.localesCount).toEqual(0);
      });
  });

  it('/api/v1/projects (POST) should accept projects with utf-8 characters in the name or description', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My second project őúüöá 😀👍🍉你好',
        description: '⛄ 😀👍 descriptiön 🍉你好',
      })
      .expect(201)
      .expect(async res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'role', 'description', 'termsCount', 'localesCount', 'date']);
        expect(res.body.data.role).toEqual('admin');
        expect(res.body.data.termsCount).toEqual(0);
        expect(res.body.data.localesCount).toEqual(0);
        expect(res.body.data.name).toEqual('My second project őúüöá 😀👍🍉你好');
        expect(res.body.data.description).toEqual('⛄ 😀👍 descriptiön 🍉你好');
      });
  });

  it('/api/v1/projects (POST) should not create a project if missing params or malformed request', async () => {
    await request(app.getHttpServer()).post('/api/v1/projects').set('Authorization', `Bearer ${testingUser.accessToken}`).send({}).expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({ name: 10 })
      .expect(400);
  });

  it('/api/v1/projects (GET) should return projects for which requesting user has access to', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toBeDefined();
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'name', 'description', 'role', 'termsCount', 'localesCount', 'date']);
        expect(res.body.data[0].id).toBe(projectId);
      });
  });

  it('/api/v1/projects (GET) should not return projects for which requesting user has no access', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toEqual([]);
      });

    // Create a project for new user
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        name: 'Also my first project',
      })
      .expect(201);

    // Check that only has access to own project
    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toBeDefined();
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0].id).not.toBe(projectId);
      });
  });

  it('/api/v1/projects/:projectId (GET) should find a project by id', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'description', 'role', 'termsCount', 'localesCount', 'date']);
      });
  });

  it('/api/v1/projects/:projectId (GET) should not find a project by id if user has no access', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer()).get(`/api/v1/projects/${projectId}`).set('Authorization', `Bearer ${anotherUser.accessToken}`).expect(404);
  });

  it('/api/v1/projects (POST) should not create a project if the user has created too many', async () => {
    let toDeleteProjectId;
    for (let i = 0; i < 100; i++) {
      const res = await request(app.getHttpServer())
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${testingUser.accessToken}`)
        .send({
          name: 'My project',
        })
        .expect(201);
      toDeleteProjectId = res.body.data.id;
    }

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My project',
      })
      .expect(429);

    await request(app.getHttpServer())
      .get('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(100);
      });

    // get rid of one project
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${toDeleteProjectId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(204);

    // now try again
    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My project',
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My project',
      })
      .expect(429);
  });

  it('/api/v1/projects/:projectId (PATCH) should update a project', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My updated project',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'description', 'role', 'termsCount', 'localesCount', 'date']);
      });
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        description: 'A short project description goes here',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'description', 'role', 'termsCount', 'localesCount', 'date']);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.id).toEqual(projectId);
        expect(res.body.data.name).toEqual('My updated project');
        expect(res.body.data.description).toEqual('A short project description goes here');
      });
  });

  it('/api/v1/projects/:projectId (PATCH) should not update a project if user has no access', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${anotherUser.accessToken}`)
      .send({
        name: 'I should not be able to update this',
      })
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${projectId}`)
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data.id).toEqual(projectId);
        expect(res.body.data.name).toEqual('My first project');
      });
  });

  it('/api/v1/projects/:projectId (DELETE) should not delete a project by id if user has no access', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer()).delete(`/api/v1/projects/${projectId}`).set('Authorization', `Bearer ${anotherUser.accessToken}`).expect(404);
  });

  it('/api/v1/projects/:projectId (DELETE) should delete a project by id', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer()).delete(`/api/v1/projects/${projectId}`).set('Authorization', `Bearer ${testingUser.accessToken}`).expect(204);
  });

  it('/api/v1/projects should not access projects resource if not authenticated', async () => {
    let projectId;

    await request(app.getHttpServer())
      .post('/api/v1/projects')
      .set('Authorization', `Bearer ${testingUser.accessToken}`)
      .send({
        name: 'My first project',
      })
      .expect(201)
      .expect(res => {
        projectId = res.body.data.id;
      });

    await request(app.getHttpServer()).post('/api/v1/projects').expect(401);

    await request(app.getHttpServer()).get('/api/v1/projects').expect(401);

    await request(app.getHttpServer()).get(`/api/v1/projects/${projectId}`).expect(401);

    await request(app.getHttpServer()).patch(`/api/v1/projects/${projectId}`).expect(401);

    await request(app.getHttpServer()).delete(`/api/v1/projects/${projectId}`).expect(401);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
