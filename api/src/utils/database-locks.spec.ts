import { isTransientDatabaseError, lockProject, lockProjectForShare } from './database-locks';

describe('isTransientDatabaseError', () => {
  it('recognizes deadlocks, lock timeouts and busy databases', () => {
    for (const code of ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', '40P01', '40001', '55P03', 'SQLITE_BUSY', 'SQLITE_LOCKED']) {
      expect(isTransientDatabaseError({ name: 'QueryFailedError', code })).toBe(true);
    }
  });

  it('leaves out every other error', () => {
    for (const error of [{ code: 'ER_DUP_ENTRY' }, { code: '23505' }, { code: 'SQLITE_CONSTRAINT' }, new Error('x'), null, undefined]) {
      expect(isTransientDatabaseError(error)).toBe(false);
    }
  });
});

describe('lockProject', () => {
  it('takes no lock on SQLite, which runs one transaction at a time', async () => {
    const entityManager: any = { findOne: jest.fn() };

    await lockProject(entityManager, 'project-1');

    expect(entityManager.findOne).not.toHaveBeenCalled();
  });
});

describe('lockProjectForShare', () => {
  it('takes no lock on SQLite, which runs one transaction at a time', async () => {
    const entityManager: any = { findOne: jest.fn() };

    await lockProjectForShare(entityManager, 'project-1');

    expect(entityManager.findOne).not.toHaveBeenCalled();
  });

  it('locks the project row for share on the other databases', async () => {
    let lock: typeof lockProjectForShare;
    let project: unknown;
    jest.isolateModules(() => {
      jest.doMock('./database-type-helper', () => ({ ...jest.requireActual('./database-type-helper'), isDbType: () => false }));
      lock = jest.requireActual('./database-locks').lockProjectForShare;
      project = jest.requireActual('../entity/project.entity').Project;
    });
    const entityManager: any = { findOne: jest.fn() };

    await lock(entityManager, 'project-1');

    expect(entityManager.findOne).toHaveBeenCalledWith(project, { where: { id: 'project-1' }, lock: { mode: 'pessimistic_read' } });
  });
});
