import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { Connection, EntityManager } from 'typeorm';
import { ProjectRole, ProjectUser } from '../src/entity/project-user.entity';
import { Project } from '../src/entity/project.entity';
import { DbType, isDbType } from '../src/utils/database-type-helper';
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

  const changeRole = (user: TestingUser, role: ProjectRole, by: TestingUser = alice) =>
    request(app.getHttpServer())
      .patch(`/api/v1/projects/${project.id}/users/${user.id}`)
      .set('Authorization', `Bearer ${by.accessToken}`)
      .send({ role });

  // The deletion's count of the users of a project it administers
  const countOfProjectUsers = (target: any, options: any) => target === ProjectUser && !!options?.where?.project;

  /**
   * Deletes Alice's account, and runs the other requests once the deletion reached `pauseAt` (by default, its count of
   * the project's users): the deletion goes on once they are done, or one of them asks for a project's lock, which the
   * deletion holds.
   */
  async function deleteAliceWhile(
    other: () => Promise<number | number[]>,
    pauseAt: (target: any, options: any) => boolean = countOfProjectUsers,
  ): Promise<[number, number | number[]]> {
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
    let otherStatus: Promise<number | number[]>;
    jest.spyOn(EntityManager.prototype, 'find').mockImplementation(async function (this: EntityManager, target: any, options: any) {
      const found = await find.call(this, target, options);
      if (!paused && pauseAt(target, options)) {
        paused = true;
        otherStatus = other();
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
    const [aliceDeleted, bobDeleted] = await deleteAliceWhile(async () => (await deleteAccount(bob)).status);

    expect(aliceDeleted).toBe(204);
    expect(bobDeleted).toBe(422);
    expect(await admins()).toEqual([bob.email]);
  });

  itConcurrently("an admin's role is taken by an account deleted at the same time: the role stays, as the last admin's", async () => {
    const [aliceDeleted, changed] = await deleteAliceWhile(async () => (await changeRole(bob, ProjectRole.Viewer)).status);

    expect(aliceDeleted).toBe(204);
    expect(changed).toBe(422);
    expect(await admins()).toEqual([bob.email]);
  });

  itConcurrently('an admin is removed by an account deleted at the same time: the admin stays, as the last one', async () => {
    const [aliceDeleted, removed] = await deleteAliceWhile(
      async () =>
        (
          await request(app.getHttpServer())
            .delete(`/api/v1/projects/${project.id}/users/${bob.id}`)
            .set('Authorization', `Bearer ${alice.accessToken}`)
        ).status,
    );

    expect(aliceDeleted).toBe(204);
    expect(removed).toBe(422);
    expect(await admins()).toEqual([bob.email]);
  });

  itConcurrently('an account is promoted while it is deleted, then the admin who promoted it deletes theirs: that admin stays', async () => {
    // Alice is a viewer of the project when her deletion reads her admin roles; Bob is its only other admin
    await changeRole(alice, ProjectRole.Viewer, bob).expect(200);
    const readsAdminRoles = (target: any, options: any) =>
      target === ProjectUser && !!options?.where?.user && options?.where?.role === ProjectRole.Admin;

    const [aliceDeleted, [promoted, bobDeleted]] = (await deleteAliceWhile(async () => {
      const promotion = (await changeRole(alice, ProjectRole.Admin, bob)).status;
      return [promotion, (await deleteAccount(bob)).status];
    }, readsAdminRoles)) as [number, number[]];

    expect(aliceDeleted).toBe(204);
    // Alice's membership went with her account before the promotion could read it
    expect(promoted).toBe(404);
    expect(bobDeleted).toBe(422);
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
