import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection, EntityManager } from 'typeorm';
import { ProjectRole, ProjectUser } from '../src/entity/project-user.entity';
import { Project } from '../src/entity/project.entity';
import { DbType, isDbType } from '../src/utils/database-type-helper';
import './util';
import { createAndMigrateApp, createTestProject, signupTestUser, TestingProject, TestingUser } from './util';

// Changes that may leave a project without an admin: an account deletion counts the project's other admins under the
// project's lock, and a role change or removal checks under the same lock that an admin stays
describe('Project admins (e2e)', () => {
  // At the same time: not on SQLite, which runs one transaction at a time, so these never interleave there
  const itConcurrently = isDbType(DbType.BETTER_SQLITE3) ? it.skip : it;

  let app: INestApplication;
  let alice: TestingUser;
  let bob: TestingUser;
  let project: TestingProject;

  beforeEach(async () => {
    app = await createAndMigrateApp();
    // Listen once, so that supertest does not close a server of its own while parallel requests use it
    await app.listen(0, '127.0.0.1');
    alice = await signupTestUser(app, 'alice@test.com');
    bob = await signupTestUser(app, 'bob@test.com');
    const carol = await signupTestUser(app, 'carol@test.com');
    project = await createTestProject(app, alice);
    await invite(bob, ProjectRole.Admin);
    // Someone else uses the project, so its last admin must stay
    await invite(carol, ProjectRole.Viewer);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await app.close();
  });

  const invite = (user: TestingUser, role: ProjectRole) =>
    request(app.getHttpServer())
      .post(`/api/v1/projects/${project.id}/invites`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ email: user.email, role })
      .expect(201);

  const deleteAccount = (user: TestingUser) =>
    request(app.getHttpServer()).delete('/api/v1/users/me').set('Authorization', `Bearer ${user.accessToken}`);

  const admins = async () =>
    (
      await app
        .get(Connection)
        .getRepository(ProjectUser)
        .find({ where: { project: { id: project.id }, role: ProjectRole.Admin }, relations: { user: true } })
    ).map(admin => admin.user.email);

  /**
   * Deletes Alice's account, and runs the other request once the deletion counted the project's users: the deletion goes
   * on once the other request is done, or asks for the project's lock, which the deletion holds.
   */
  async function deleteAliceWhile(other: () => request.Test): Promise<[number, number]> {
    let lockRequested: () => void;
    const waitsForLock = new Promise<void>(resolve => (lockRequested = resolve));
    let paused = false;

    const findOne = EntityManager.prototype.findOne;
    jest.spyOn(EntityManager.prototype, 'findOne').mockImplementation(function (this: EntityManager, target: any, options: any) {
      if (paused && target === Project && options?.lock) {
        lockRequested();
      }
      return findOne.call(this, target, options);
    } as any);

    const find = EntityManager.prototype.find;
    let otherStatus: Promise<number>;
    jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, target: any, options: any) {
      const found = await find.call(this, target, options);
      // The deletion's count of the users of the project it administers
      if (target === ProjectUser && options?.where?.project && !paused) {
        paused = true;
        otherStatus = other().then(res => res.status);
        await Promise.race([otherStatus, waitsForLock]);
      }
      return found;
    } as any);

    try {
      const deleted = await deleteAccount(alice);
      return [deleted.status, await otherStatus];
    } finally {
      jest.restoreAllMocks();
    }
  }

  itConcurrently('two admins delete their accounts at the same time: one stays, as the last admin of the project', async () => {
    const [aliceDeleted, bobDeleted] = await deleteAliceWhile(() => deleteAccount(bob));

    expect(aliceDeleted).toBe(204);
    expect(bobDeleted).toBe(422);
    expect(await admins()).toEqual([bob.email]);
  });

  itConcurrently("an admin's role is taken by an account deleted at the same time: the role stays, as the last admin's", async () => {
    const [aliceDeleted, changed] = await deleteAliceWhile(() =>
      request(app.getHttpServer())
        .patch(`/api/v1/projects/${project.id}/users/${bob.id}`)
        .set('Authorization', `Bearer ${alice.accessToken}`)
        .send({ role: ProjectRole.Viewer }),
    );

    expect(aliceDeleted).toBe(204);
    expect(changed).toBe(422);
    expect(await admins()).toEqual([bob.email]);
  });

  itConcurrently('an admin is removed by an account deleted at the same time: the admin stays, as the last one', async () => {
    const [aliceDeleted, removed] = await deleteAliceWhile(() =>
      request(app.getHttpServer()).delete(`/api/v1/projects/${project.id}/users/${bob.id}`).set('Authorization', `Bearer ${alice.accessToken}`),
    );

    expect(aliceDeleted).toBe(204);
    expect(removed).toBe(422);
    expect(await admins()).toEqual([bob.email]);
  });

  it('an admin still takes the role of another admin, or removes them, while a third admin stays', async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${project.id}/users/${bob.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ role: ProjectRole.Editor })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/projects/${project.id}/users/${bob.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .send({ role: ProjectRole.Admin })
      .expect(200);
    await request(app.getHttpServer())
      .delete(`/api/v1/projects/${project.id}/users/${bob.id}`)
      .set('Authorization', `Bearer ${alice.accessToken}`)
      .expect(204);

    expect(await admins()).toEqual([alice.email]);
  });
});
