import {
  isTransientDatabaseError,
  lockProject,
  lockProjectForShare,
  lockTerm,
  readCommittedTransaction,
  translationEditLockKey,
  withEditLock,
  withTermLabelEditLock,
} from './database-locks';

/** The module as another database than the tests' SQLite loads it, and the term entity it locks */
function loadOn(dbType: 'postgres' | 'mysql') {
  let locks: typeof import('./database-locks');
  let term: unknown;
  jest.isolateModules(() => {
    jest.doMock('./database-type-helper', () => ({ ...jest.requireActual('./database-type-helper'), isDbType: (type: string) => type === dbType }));
    locks = jest.requireActual('./database-locks');
    term = jest.requireActual('../entity/term.entity').Term;
  });
  return { locks, term };
}

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

describe('lockTerm', () => {
  it('takes no lock on SQLite, which takes no row locks', async () => {
    const entityManager: any = { findOne: jest.fn() };

    await lockTerm(entityManager, 'term-1');

    expect(entityManager.findOne).not.toHaveBeenCalled();
  });

  it('locks the term row for no key update on Postgres: the foreign-key checks of rows that reference it go on', async () => {
    const { locks, term } = loadOn('postgres');
    const entityManager: any = { findOne: jest.fn() };

    await locks.lockTerm(entityManager, 'term-1');

    expect(entityManager.findOne).toHaveBeenCalledWith(term, { where: { id: 'term-1' }, lock: { mode: 'for_no_key_update' } });
  });

  it('locks the term row for update on MySQL', async () => {
    const { locks, term } = loadOn('mysql');
    const entityManager: any = { findOne: jest.fn() };

    await locks.lockTerm(entityManager, 'term-1');

    expect(entityManager.findOne).toHaveBeenCalledWith(term, { where: { id: 'term-1' }, lock: { mode: 'pessimistic_write' } });
  });
});

describe('withTermLabelEditLock', () => {
  // A write of a translation that holds its edit lock until `release` is called
  const holdTranslationEditLock = (edit: typeof withEditLock, key: string, done: () => void) => {
    let release: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const write = edit(key, () => held.then(done));
    return { release: () => release(), write };
  };
  const yieldToOthers = () => new Promise(resolve => setImmediate(resolve));

  it('on SQLite, which takes no row locks, waits for a write of a translation that holds its edit lock', async () => {
    const order: string[] = [];
    const translation = holdTranslationEditLock(withEditLock, translationEditLockKey('locale-1', 'term-1'), () => order.push('translation'));

    const labeled = withTermLabelEditLock(async () => order.push('term label'));
    await yieldToOthers();
    expect(order).toEqual([]);

    translation.release();
    await Promise.all([translation.write, labeled]);
    expect(order).toEqual(['translation', 'term label']);
  });

  it('runs at once on the other databases, where the change locks the term row instead', async () => {
    for (const dbType of ['postgres', 'mysql'] as const) {
      const { locks } = loadOn(dbType);
      const order: string[] = [];
      const translation = holdTranslationEditLock(locks.withEditLock, locks.translationEditLockKey('locale-1', 'term-1'), () =>
        order.push('translation'),
      );

      await locks.withTermLabelEditLock(async () => order.push('term label'));
      expect(order).toEqual(['term label']);

      translation.release();
      await translation.write;
    }
  });
});

describe('readCommittedTransaction', () => {
  const work = async () => 'done';
  const managerMock = (): any => ({ transaction: jest.fn(async (...args: any[]) => args[args.length - 1]()) });

  it('starts a transaction with no isolation level on SQLite, which runs one transaction at a time', async () => {
    const manager = managerMock();

    expect(await readCommittedTransaction(manager, work)).toBe('done');

    expect(manager.transaction).toHaveBeenCalledWith(work);
  });

  it('reads committed on the other databases, so a read after a lock wait sees what the other transaction committed', async () => {
    for (const dbType of ['postgres', 'mysql'] as const) {
      const { locks } = loadOn(dbType);
      const manager = managerMock();

      expect(await locks.readCommittedTransaction(manager, work)).toBe('done');

      expect(manager.transaction).toHaveBeenCalledWith('READ COMMITTED', work);
    }
  });
});
