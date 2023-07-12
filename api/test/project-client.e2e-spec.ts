import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { ProjectRole } from '../src/entity/project-user.entity';
import './util';
import {
  createAndMigrateApp,
  createTestProject,
  createTestProjectClient,
  signupTestUser,
  TestingProject,
  TestingProjectClient,
  TestingUser,
} from './util';

describe('ProjectClientController (e2e)', () => {
  let app: INestApplication;
  let testingUser1: TestingUser;
  let testingUser2: TestingUser;
  let testProject1: TestingProject;
  let testProject1b: TestingProject;
  let testProject1c: TestingProject;
  let testProject2: TestingProject;

  let testProjectClient1: TestingProjectClient;
  let testProjectClient2: TestingProjectClient;
  let testProjectClient3: TestingProjectClient;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser1 = await signupTestUser(app);
    testingUser2 = await signupTestUser(app, 'another-user@test.com');
    testProject1 = await createTestProject(app, testingUser1);
    testProject1b = await createTestProject(app, testingUser1);
    testProject1c = await createTestProject(app, testingUser1);
    testProject2 = await createTestProject(app, testingUser2);

    testProjectClient1 = await createTestProjectClient(app, testingUser1, testProject1);
    testProjectClient2 = await createTestProjectClient(app, testingUser2, testProject2);
    testProjectClient3 = await createTestProjectClient(app, testingUser1, testProject1c);
  });

  it('/api/v1/projects/:projectId/clients (GET) should return all project clients', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'name', 'role']);
        expect(res.body.data[0]).toEqual({
          id: testProjectClient1.id,
          name: testProjectClient1.name,
          role: testProjectClient1.role,
        });
      });

    // project b has no clients
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1b.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => expect(res.body.data).toHaveLength(0));

    // project c has
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1c.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'name', 'role']);
        expect(res.body.data[0]).toEqual({
          id: testProjectClient3.id,
          name: testProjectClient3.name,
          role: testProjectClient3.role,
        });
      });

    // the other user can only access his project's clients
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject2.id}/clients`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'name', 'role']);
        expect(res.body.data[0]).toEqual({
          id: testProjectClient2.id,
          name: testProjectClient2.name,
          role: testProjectClient2.role,
        });
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/clients`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1b.id}/clients`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .expect(404);
  });

  it('/api/v1/projects/:projectId/clients (POST) should create a project clients, and be able to authenticate with the secret given', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1b.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(0);
      });

    let newClientId: string;
    let newClientSecret: string;

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1b.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        name: 'My new project client',
        role: ProjectRole.Editor,
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'role', 'secret']);
        newClientId = res.body.data.id;
        newClientSecret = res.body.data.secret;
      });

    await request(app.getHttpServer())
      .post('/api/v1/auth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: newClientId,
        client_secret: newClientSecret,
      })
      .expect(200)
      .expect(res => {
        expect(res.body).toHaveExactProperties(['access_token', 'expires_in', 'token_type']);
        expect(res.body.access_token).toBeDefined();
        expect(res.body.expires_in).toBeDefined();
        expect(res.body.token_type).toBeDefined();
      });
  });

  it('/api/v1/projects/:projectId/clients (POST) should not create a project client if the request is malformed', async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1b.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: ProjectRole.Editor,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1b.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        name: 'My new project client',
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1b.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        name: 'My new project client',
        role: 'bad',
      })
      .expect(400);
  });

  it('/api/v1/projects/:projectId/clients/:clientId (PATCH) should be able to edit project clients if allowed', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/clients/${testProjectClient1.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: ProjectRole.Editor,
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'role']);
        expect(res.body.data.role).toEqual('editor');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'name', 'role']);
        expect(res.body.data[0]).toEqual({
          id: testProjectClient1.id,
          name: testProjectClient1.name,
          role: 'editor',
        });
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/clients/${testProjectClient1.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: ProjectRole.Admin,
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveExactProperties(['id', 'name', 'role']);
        expect(res.body.data.role).toEqual('admin');
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'name', 'role']);
        expect(res.body.data[0]).toEqual({
          id: testProjectClient1.id,
          name: testProjectClient1.name,
          role: 'admin',
        });
      });
  });

  it('/api/v1/projects/:projectId/clients/:clientId (DELETE) should remove project clients if allowed', async () => {
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject1.id}/clients/${testProjectClient1.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/clients`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(0);
      });
  });

  it('a project client should be able to access endpoints according to its role', async () => {
    // try to get project terms
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/terms`)
      .set('Authorization', `Bearer ${testProjectClient1.accessToken}`)
      .expect(200);

    // try to get project translations
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/translations`)
      .set('Authorization', `Bearer ${testProjectClient1.accessToken}`)
      .expect(200);

    // try to create project translations with wrong role
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/translations`)
      .set('Authorization', `Bearer ${testProjectClient1.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(404);

    // try to add project terms with wrong role
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/terms`)
      .set('Authorization', `Bearer ${testProjectClient1.accessToken}`)
      .send({
        value: 'first.term',
      })
      .expect(404);

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/clients/${testProjectClient1.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: ProjectRole.Editor,
      })
      .expect(200);

    // now try again with the right role
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/terms`)
      .set('Authorization', `Bearer ${testProjectClient1.accessToken}`)
      .send({
        value: 'first.term',
      })
      .expect(201);

    // try to create project translations with wrong role
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/translations`)
      .set('Authorization', `Bearer ${testProjectClient1.accessToken}`)
      .send({
        code: 'de_DE',
      })
      .expect(201);

    // try to export project translations
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/exports?locale=de_DE&format=jsonflat&untranslated=false`)
      .set('Authorization', `Bearer ${testProjectClient1.accessToken}`)
      .expect(200);
  });

  it('a project client should not be able to access non-project specific endpoints', async () => {
    await request(app.getHttpServer()).get(`/api/v1/projects`).set('Authorization', `Bearer ${testProjectClient1.accessToken}`).expect(401);

    await request(app.getHttpServer())
      .post(`/api/v1/projects`)
      .set('Authorization', `Bearer ${testProjectClient1.accessToken}`)
      .send({
        name: 'bla',
      })
      .expect(401);

    await request(app.getHttpServer()).get(`/api/v1/users/me`).set('Authorization', `Bearer ${testProjectClient1.accessToken}`).expect(401);
  });

  it('a project client should not be able to access a project which is not his own', async () => {
    // try to get project terms
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/terms`)
      .set('Authorization', `Bearer ${testProjectClient2.accessToken}`)
      .expect(404);

    // try to get project translations
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/translations`)
      .set('Authorization', `Bearer ${testProjectClient2.accessToken}`)
      .expect(404);
  });

  it('/api/v1/projects/:projectId/clients should not access project clients resource if not authenticated', async () => {
    await request(app.getHttpServer()).get(`/api/v1/projects/${testProject1.id}/clients`).expect(401);
  });

  it('/api/v1/projects/:projectId/clients should not access project clients resource if not authorized', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/clients`)
      .set('Authorization', `Bearer ${testingUser2.accessToken}`)
      .expect(404);
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
