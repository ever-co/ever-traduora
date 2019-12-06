import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

describe('ProjectInviteController (e2e)', () => {
  let app: INestApplication;
  let testingUser1: TestingUser;
  let testingUser2: TestingUser;
  let testProject1: TestingProject;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    testingUser1 = await signupTestUser(app);
    testingUser2 = await signupTestUser(app, 'another-user@test.com');
    testProject1 = await createTestProject(app, testingUser1);
  });

  it('/api/v1/projects/:projectId/invites (GET) should return all project invites including self', async () => {
    const invite = {
      email: 'anotheruser@test.com',
      role: 'editor',
    };
    const {
      body: { data: testingInvite },
    } = await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        email: invite.email,
        role: invite.role,
      })
      .expect(res => {
        expect(res.body.data.email).toEqual(invite.email);
        expect(res.body.data.role).toEqual(invite.role);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'email', 'status', 'role']);
        expect(res.body.data[0].id).toEqual(testingInvite.id);
        expect(res.body.data[0].email).toEqual(testingInvite.email);
      });
  });

  it('/api/v1/projects/:projectId/invites (POST) with a new user should create a new invite', async () => {
    const invite = {
      email: 'anotheruser@test.com',
      role: 'editor',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        email: invite.email,
        role: invite.role,
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data.id).toBeTruthy();
        expect(res.body.data.email).toEqual(invite.email);
        expect(res.body.data.role).toEqual(invite.role);
      });
  });

  it('/api/v1/projects/:projectId/invites (POST) with an existing user should create a new project user', async () => {
    const invite = {
      email: testingUser2.email,
      role: 'editor',
    };
    await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        email: invite.email,
        role: invite.role,
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data.userId).toEqual(testingUser2.id);
        expect(res.body.data.name).toEqual(testingUser2.name);
        expect(res.body.data.email).toEqual(invite.email);
        expect(res.body.data.role).toEqual(invite.role);
      });
  });

  it('/api/v1/projects/:projectId/invites/:inviteId (PATCH) should update the role of the invite', async () => {
    const invite = {
      email: 'anotheruser@test.com',
      role: 'editor',
    };
    const {
      body: { data: testingInvite },
    } = await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        email: invite.email,
        role: invite.role,
      })
      .expect(201)
      .expect(res => {
        expect(res.body.data.id).toBeTruthy();
        expect(res.body.data.email).toEqual(invite.email);
        expect(res.body.data.role).toEqual(invite.role);
      });

    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${testProject1.id}/invites/${testingInvite.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        role: 'viewer',
      })
      .expect(200)
      .expect(res => {
        expect(res.body.data.id).toBeTruthy();
        expect(res.body.data.email).toEqual(invite.email);
        expect(res.body.data.role).toEqual('viewer');
      });
  });

  it('/api/v1/projects/:projectId/invites/:inviteId (DELETE) should delete the invite', async () => {
    const invite = {
      email: 'anotheruser@test.com',
      role: 'editor',
    };
    const {
      body: { data: testingInvite },
    } = await request(app.getHttpServer())
      .post(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .send({
        email: invite.email,
        role: invite.role,
      })
      .expect(res => {
        expect(res.body.data.email).toEqual(invite.email);
        expect(res.body.data.role).toEqual(invite.role);
      });

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(1);
        expect(res.body.data[0]).toHaveExactProperties(['id', 'email', 'status', 'role']);
        expect(res.body.data[0].id).toEqual(testingInvite.id);
        expect(res.body.data[0].email).toEqual(testingInvite.email);
      });

    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${testProject1.id}/invites/${testingInvite.id}`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/api/v1/projects/${testProject1.id}/invites`)
      .set('Authorization', `Bearer ${testingUser1.accessToken}`)
      .expect(200)
      .expect(res => {
        expect(res.body.data).toHaveLength(0);
      });
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
