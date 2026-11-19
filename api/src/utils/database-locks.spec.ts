import { isTransientDatabaseError, lockProject } from './database-locks';

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
