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

  describe('invites belonging to another project', () => {
    let testProject2: TestingProject;
    let foreignInvite: { id: string; email: string; role: string };

    beforeEach(async () => {
      // testingUser2 administers their own project and is only a viewer in testProject1,
      // which is enough to list testProject1's pending invite ids
      testProject2 = await createTestProject(app, testingUser2);

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject1.id}/invites`)
        .set('Authorization', `Bearer ${testingUser1.accessToken}`)
        .send({ email: testingUser2.email, role: 'viewer' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject1.id}/invites`)
        .set('Authorization', `Bearer ${testingUser1.accessToken}`)
        .send({ email: 'anotheruser@test.com', role: 'viewer' })
        .expect(201);

      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject1.id}/invites`)
        .set('Authorization', `Bearer ${testingUser2.accessToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body.data).toHaveLength(1);
          foreignInvite = res.body.data[0];
        });
    });

    it('/api/v1/projects/:projectId/invites/:inviteId (PATCH) should not update an invite of another project', async () => {
      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject2.id}/invites/${foreignInvite.id}`)
        .set('Authorization', `Bearer ${testingUser2.accessToken}`)
        .send({ role: 'admin' })
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject1.id}/invites`)
        .set('Authorization', `Bearer ${testingUser1.accessToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].id).toEqual(foreignInvite.id);
          expect(res.body.data[0].role).toEqual('viewer');
        });
    });

    it('/api/v1/projects/:projectId/invites/:inviteId (DELETE) should not delete an invite of another project', async () => {
      await request(app.getHttpServer())
        .delete(`/api/v1/projects/${testProject2.id}/invites/${foreignInvite.id}`)
        .set('Authorization', `Bearer ${testingUser2.accessToken}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject1.id}/invites`)
        .set('Authorization', `Bearer ${testingUser1.accessToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body.data).toHaveLength(1);
          expect(res.body.data[0].id).toEqual(foreignInvite.id);
        });
    });
  });

  describe('accepting an invite by signing up', () => {
    const inviteeEmail = 'invitee@test.com';
    let inviteUrl: string;

    const inviteToken = (url: string) => new URL(url).searchParams.get('invite');

    const signup = (email: string, token?: string) =>
      request(app.getHttpServer())
        .post('/api/v1/auth/signup')
        .send({ name: 'Invitee', email, password: 'mysupersecretpassword', ...(token ? { inviteToken: token } : {}) });

    const pendingInvites = () =>
      request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject1.id}/invites`)
        .set('Authorization', `Bearer ${testingUser1.accessToken}`)
        .expect(200)
        .then(res => res.body.data);

    beforeEach(async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject1.id}/invites`)
        .set('Authorization', `Bearer ${testingUser1.accessToken}`)
        .send({ email: inviteeEmail, role: 'admin' })
        .expect(201)
        .expect(res => {
          expect(res.body.data).toHaveExactProperties(['id', 'email', 'status', 'role', 'inviteUrl']);
          inviteUrl = res.body.data.inviteUrl;
        });
      expect(inviteToken(inviteUrl)).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should not sign up an invited email without the invite token', async () => {
      await signup(inviteeEmail).expect(401);
      await signup(inviteeEmail, 'not-the-token').expect(401);

      const invites = await pendingInvites();
      expect(invites).toHaveLength(1);
      expect(invites[0].email).toEqual(inviteeEmail);
    });

    it('should not accept an invite with a token issued for another email', async () => {
      await signup('someone-else@test.com', inviteToken(inviteUrl))
        .expect(200)
        .expect(res => {
          expect(res.body.data.email).toEqual('someone-else@test.com');
        })
        .then(res =>
          request(app.getHttpServer())
            .get(`/api/v1/projects/${testProject1.id}`)
            .set('Authorization', `Bearer ${res.body.data.accessToken}`)
            .expect(404),
        );

      expect(await pendingInvites()).toHaveLength(1);
    });

    it('should accept the invite when signing up with its token', async () => {
      const {
        body: { data: invitee },
      } = await signup(inviteeEmail, inviteToken(inviteUrl)).expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject1.id}`)
        .set('Authorization', `Bearer ${invitee.accessToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body.data.role).toEqual('admin');
        });

      expect(await pendingInvites()).toHaveLength(0);
    });

    it('should not accept invites of other projects with a link from your own project', async () => {
      // testingUser2 invites the same email to their own project and receives that invite's link
      const testProject2 = await createTestProject(app, testingUser2);
      let ownUrl: string;
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject2.id}/invites`)
        .set('Authorization', `Bearer ${testingUser2.accessToken}`)
        .send({ email: inviteeEmail, role: 'viewer' })
        .expect(201)
        .expect(res => {
          ownUrl = res.body.data.inviteUrl;
        });

      const {
        body: { data: account },
      } = await signup(inviteeEmail, inviteToken(ownUrl)).expect(200);

      await request(app.getHttpServer()).get(`/api/v1/projects/${testProject2.id}`).set('Authorization', `Bearer ${account.accessToken}`).expect(200);
      await request(app.getHttpServer()).get(`/api/v1/projects/${testProject1.id}`).set('Authorization', `Bearer ${account.accessToken}`).expect(404);

      const invites = await pendingInvites();
      expect(invites).toHaveLength(1);
      expect(invites[0].role).toEqual('admin');
    });

    it('should accept another pending invite with its link once the account exists', async () => {
      const testProject2 = await createTestProject(app, testingUser2);
      let secondUrl: string;
      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject2.id}/invites`)
        .set('Authorization', `Bearer ${testingUser2.accessToken}`)
        .send({ email: inviteeEmail, role: 'viewer' })
        .expect(201)
        .expect(res => {
          secondUrl = res.body.data.inviteUrl;
        });

      const {
        body: { data: invitee },
      } = await signup(inviteeEmail, inviteToken(inviteUrl)).expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .send({ inviteToken: inviteToken(secondUrl) })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .set('Authorization', `Bearer ${invitee.accessToken}`)
        .send({ inviteToken: inviteToken(secondUrl) })
        .expect(200)
        .expect(res => {
          expect(res.body.data).toEqual({ projectId: testProject2.id, role: 'viewer' });
        });

      await request(app.getHttpServer()).get(`/api/v1/projects/${testProject2.id}`).set('Authorization', `Bearer ${invitee.accessToken}`).expect(200);

      // A used link does not work again
      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .set('Authorization', `Bearer ${invitee.accessToken}`)
        .send({ inviteToken: inviteToken(secondUrl) })
        .expect(404);
    });

    it('should not accept an invite for another email with its link', async () => {
      const {
        body: { data: someoneElse },
      } = await signup('someone-else@test.com').expect(200);

      await request(app.getHttpServer())
        .post('/api/v1/auth/accept-invite')
        .set('Authorization', `Bearer ${someoneElse.accessToken}`)
        .send({ inviteToken: inviteToken(inviteUrl) })
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject1.id}`)
        .set('Authorization', `Bearer ${someoneElse.accessToken}`)
        .expect(404);
      expect(await pendingInvites()).toHaveLength(1);
    });

    it('should keep the invite link when changing the role of the invite', async () => {
      const [invite] = await pendingInvites();

      await request(app.getHttpServer())
        .patch(`/api/v1/projects/${testProject1.id}/invites/${invite.id}`)
        .set('Authorization', `Bearer ${testingUser1.accessToken}`)
        .send({ role: 'editor' })
        .expect(200)
        .expect(res => {
          expect(res.body.data).toHaveExactProperties(['id', 'email', 'status', 'role']);
          expect(res.body.data.role).toEqual('editor');
        });

      const {
        body: { data: invitee },
      } = await signup(inviteeEmail, inviteToken(inviteUrl)).expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject1.id}`)
        .set('Authorization', `Bearer ${invitee.accessToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body.data.role).toEqual('editor');
        });
    });

    it('should replace the invite link when inviting the same email again', async () => {
      const firstUrl = inviteUrl;
      let secondUrl: string;

      await request(app.getHttpServer())
        .post(`/api/v1/projects/${testProject1.id}/invites`)
        .set('Authorization', `Bearer ${testingUser1.accessToken}`)
        .send({ email: inviteeEmail, role: 'viewer' })
        .expect(201)
        .expect(res => {
          expect(res.body.data.role).toEqual('viewer');
          secondUrl = res.body.data.inviteUrl;
        });

      expect(secondUrl).not.toEqual(firstUrl);

      const invites = await pendingInvites();
      expect(invites).toHaveLength(1);
      expect(invites[0].role).toEqual('viewer');

      await signup(inviteeEmail, inviteToken(firstUrl)).expect(401);

      const {
        body: { data: invitee },
      } = await signup(inviteeEmail, inviteToken(secondUrl)).expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/projects/${testProject1.id}`)
        .set('Authorization', `Bearer ${invitee.accessToken}`)
        .expect(200)
        .expect(res => {
          expect(res.body.data.role).toEqual('viewer');
        });
    });
  });

  afterEach(async () => {
    await app.get(Connection).close();
    await app.close();
  });
});
