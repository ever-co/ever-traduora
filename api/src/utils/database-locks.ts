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

/** A conflict the database resolved by failing the statement (deadlock, lock wait timeout, busy): a retry can succeed */
export function isTransientDatabaseError(error: any): boolean {
  return ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', '40P01', '40001', '55P03', 'SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code);
}
