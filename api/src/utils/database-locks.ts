import { EntityManager } from 'typeorm';
import { Project } from '../entity/project.entity';
import { DbType, isDbType } from './database-type-helper';

/**
 * Locks the project's row for the rest of the transaction. Every transaction that changes the project's counters
 * (adding or removing terms or locales, imports) takes it first, before any other lock: they then run one at a time
 * per project and lock the other rows in the same order. Otherwise MySQL deadlocks them, as the shared locks its
 * foreign-key checks take on the project come before the exclusive one the counter update needs. On Postgres the lock
 * is the one the counter update takes anyway (FOR NO KEY UPDATE), so rows that only reference the project are not held
 * up. SQLite runs one transaction at a time.
 */
export async function lockProject(entityManager: EntityManager, projectId: string): Promise<void> {
  if (isDbType(DbType.BETTER_SQLITE3)) {
    return;
  }
  await entityManager.findOne(Project, {
    where: { id: projectId },
    lock: { mode: isDbType(DbType.POSTGRES) ? 'for_no_key_update' : 'pessimistic_write' },
  });
}

const editLocks = new Map<string, Promise<unknown>>();

/** Runs the work after every earlier work with the same key, one at a time, whether or not the earlier work failed */
export async function withEditLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = editLocks.get(key) ?? Promise.resolve();
  const run = previous.then(work);
  const tail = run.catch(() => undefined);
  editLocks.set(key, tail);
  try {
    return await run;
  } finally {
    if (editLocks.get(key) === tail) {
      editLocks.delete(key);
    }
  }
}

/**
 * The key of the edit lock of one translation, which every write that may add the translation takes: a save of its
 * value, and a label that adds it. SQLite has a single connection that TypeORM shares between transactions, so there
 * every such write shares one key.
 */
export function translationEditLockKey(projectLocaleId: string, termId: string): string {
  return isDbType(DbType.BETTER_SQLITE3) ? 'sqlite' : `${projectLocaleId}:${termId}`;
}

/** A conflict the database resolved by failing the statement (deadlock, lock wait timeout, busy): a retry can succeed */
export function isTransientDatabaseError(error: any): boolean {
  return ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', '40P01', '40001', '55P03', 'SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code);
}
