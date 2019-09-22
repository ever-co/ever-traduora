import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('ProjectUserController (e2e)', () => {
  let app: INestApplication;
  let testingUser1: TestingUser;
  let testingUser2: TestingUser;
  let testingUser3: TestingUser;
  let testProject1: TestingProject;
  let testProject1b: TestingProject;
  let testProject1c: TestingProject;
  let testProject2: TestingProject;
  let testProject3: TestingProject;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser1 = await signupTestUser(app);
    testingUser2 = await signupTestUser(app, 'another-user@test.com');
    testingUser3 = await signupTestUser(app, 'yet-another-user@test.com');
    testProject1 = await createTestProject(app, testingUser1);
    testProject1b = await createTestProject(app, testingUser1);
    testProject1c = await createTestProject(app, testingUser1);
    testProject2 = await createTestProject(app, testingUser2);
    testProject3 = await createTestProject(app, testingUser3);
  });

  it('/api/v1/projects/:projectId/users (GET) should return all project users including self', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/users`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['userId', 'email', 'name', 'role']);
        expect(res.body.data[0].userId).toEqual(testingUser1.id);
        expect(res.body.data[0].email).toEqual(testingUser1.email);
      });
  });

  it('/api/v1/projects/:projectId/users/:userId (PATCH) should be able to edit project users if allowed', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        email: testingUser2.email,
        role: 'editor',
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['userId', 'email', 'name', 'role']);
        expect(res.body.data.userId).toEqual(testingUser2.id);
        expect(res.body.data.name).toEqual(testingUser2.name);
        expect(res.body.data.email).toEqual(testingUser2.email);
        expect(res.body.data.role).toEqual('editor');
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/users/${testingUser2.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: 'viewer',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['userId', 'email', 'name', 'role']);
        expect(res.body.data.userId).toEqual(testingUser2.id);
        expect(res.body.data.name).toEqual(testingUser2.name);
        expect(res.body.data.email).toEqual(testingUser2.email);
        expect(res.body.data.role).toEqual('viewer');
      });

    // user 2 should not be able to change the admin
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/users/${testingUser1.id}`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .send({
        role: 'viewer',
      })
      .expect(404); // mapped to 404 to prevent id probing

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/users/${testingUser2.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: 'editor',
      })
      .expect(200);
  });

  it('/api/v1/projects/:projectId/users/:userId (PATCH) should not affect the other projects from that user', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        email: testingUser2.email,
        role: 'admin',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/users/${testingUser1.id}`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .send({
        role: 'viewer',
      })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        const rolesByProject = res.body.data.reduce((acc, p) => ({ ...acc, [p.id]: p.role }), {});
        expect(rolesByProject[testProject1.id]).toEqual('viewer');
        expect(rolesByProject[testProject1b.id]).toEqual('admin');
        expect(rolesByProject[testProject1c.id]).toEqual('admin');
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/users/${testingUser1.id}`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .send({
        role: 'admin',
      })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: 'admin',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        const rolesByProject = res.body.data.reduce((acc, p) => ({ ...acc, [p.id]: p.role }), {});
        expect(rolesByProject[testProject1.id]).toEqual('admin');
        expect(rolesByProject[testProject1b.id]).toEqual('admin');
        expect(rolesByProject[testProject1c.id]).toEqual('admin');
      });

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1c.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        email: testingUser2.email,
        role: 'admin',
      })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1c.id}/users/${testingUser1.id}`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .send({
        role: 'editor',
      })
      .expect(200);

    await request(app.getHttpServer())
      .get(`/api/v1/projects`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(3);
        const rolesByProject = res.body.data.reduce((acc, p) => ({ ...acc, [p.id]: p.role }), {});
        expect(rolesByProject[testProject1.id]).toEqual('admin');
        expect(rolesByProject[testProject1b.id]).toEqual('admin');
        expect(rolesByProject[testProject1c.id]).toEqual('editor');
      });
  });

  it('/api/v1/projects/:projectId/users/:userId (PATCH) should not be able to edit or remove yourself', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/users/${testingUser1.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: 'viewer',
      })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject1.id}/users/${testingUser1.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(400);
  });

  it('/api/v1/projects/:projectId/users/:userId (DELETE) should remove project users if allowed', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject1.id}/users/${testingUser2.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(204);

    // user 2 should not be able to access anymore
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/users/${testingUser1.id}`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .send({
        role: 'viewer',
      })
      .expect(404); // mapped to 404 to prevent id probing

    // user 2 should not be able to access anymore
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .expect(404); // mapped to 404 to prevent id probing

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/users`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['userId', 'email', 'name', 'role']);
        expect(res.body.data[0].userId).toEqual(testingUser1.id);
        expect(res.body.data[0].email).toEqual(testingUser1.email);
      });
  });

  it('/api/v1/projects/:projectId/users should not access project users resource if not authenticated', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/users`)
      .expect(401);
  });

  it('/api/v1/projects/:projectId/users should not access project users resource if not authorized', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/users`)
      .set('Authorization', `Bearer ${testingUser3.accessToken}`)
      .expect(404);
  });

  afterEach(async () => {
    await app.close();
  });
});
