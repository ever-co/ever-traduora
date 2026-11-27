import { EntityManager, In } from 'typeorm';
import { ProjectUser } from '../entity/project-user.entity';
import { Project } from '../entity/project.entity';
import { Term } from '../entity/term.entity';
import { User } from '../entity/user.entity';
import { DbType, isDbType } from './database-type-helper';

/**
 * Locks the accounts' rows (FOR UPDATE) for the rest of the transaction, in the order of their ids: the first locks of
 * the global order, account → projects → organizations (see `lockOrganization`). For a transaction that deletes the
 * accounts or writes rows that reference them under later locks. SQLite runs one transaction at a time.
 */
export async function lockAccounts(entityManager: EntityManager, userIds: ReadonlyArray<string>): Promise<void> {
  if (isDbType(DbType.BETTER_SQLITE3)) {
    return;
  }
  for (const userId of Array.from(new Set(userIds)).sort(byCodeUnits)) {
    await entityManager.findOne(User, { where: { id: userId }, select: ['id'], lock: { mode: 'pessimistic_write' } });
  }
}

/**
 * Locks the account's row for share, first: for a transaction that writes rows referencing the account (an import's
 * history) after its project and organization locks, whose foreign key would otherwise take that lock last, against the
 * global order. SQLite runs one transaction at a time.
 */
export async function lockAccountForShare(entityManager: EntityManager, userId: string): Promise<void> {
  if (isDbType(DbType.BETTER_SQLITE3)) {
    return;
  }
  await entityManager.findOne(User, { where: { id: userId }, select: ['id'], lock: { mode: 'pessimistic_read' } });
}

/**
 * Locks the project's row for the rest of the transaction. Every transaction that changes the project's counters
 * (adding or removing terms or locales, imports) takes it first, before any other lock but its account's; in SaaS mode an
 * add then locks its organization to count the strings (`lockOrganizationForStrings`, global order account → projects →
 * organization, see `lockOrganization`): they then run one at a time
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

/**
 * Locks the rows of the projects, in the order of their ids, for a change that may leave one of them without an admin:
 * an account deletion (*Delete account* or Ever Platform's), a project role change or a removal from a project. Each
 * runs in a {@link readCommittedTransaction} and locks the projects before it counts their admins, so another such
 * change waits for it and then counts what it left: two of them never each count the other's admin as the one who
 * stays. SQLite runs one transaction at a time.
 */
export async function lockProjects(entityManager: EntityManager, projectIds: ReadonlyArray<string>): Promise<void> {
  // One at a time and in one order (by code unit, the same everywhere): that order is what keeps two such changes from
  // waiting for each other
  for (const projectId of Array.from(new Set(projectIds)).sort(byCodeUnits)) {
    await lockProject(entityManager, projectId);
  }
}

/**
 * Locks every project the accounts belong to, in any role ({@link lockProjects}), for a deletion of the accounts. Their
 * admin roles are to be read only after this: a role change (a promotion) locks the project too, so it either committed
 * before the read or waits for the deletion. A membership added meanwhile waits for the account's own lock (its foreign
 * key), which the deletion takes first. SQLite runs one transaction at a time.
 */
export async function lockProjectsOf(entityManager: EntityManager, userIds: ReadonlyArray<string>): Promise<void> {
  if (isDbType(DbType.BETTER_SQLITE3) || !userIds.length) {
    return;
  }
  const memberships = await entityManager.getRepository(ProjectUser).find({
    where: { user: { id: In([...userIds]) } },
    relations: { project: true },
  });
  await lockProjects(
    entityManager,
    memberships.filter(membership => membership.project).map(membership => membership.project.id),
  );
}

/** The one order of ids for taking several locks of a kind (projects, organizations): by code unit, the same everywhere */
export function byCodeUnits(a: string, b: string): number {
  if (a < b) {
    return -1;
  }
  return a > b ? 1 : 0;
}

/**
 * Locks the project's row for share for the rest of the transaction, taken first like {@link lockProject}: the
 * transaction waits for one that holds the project locked (an import, a new locale) to commit, and such a transaction
 * waits for it, while transactions that lock it for share do not wait for each other. SQLite runs one transaction at a
 * time.
 */
export async function lockProjectForShare(entityManager: EntityManager, projectId: string): Promise<void> {
  if (isDbType(DbType.BETTER_SQLITE3)) {
    return;
  }
  await entityManager.findOne(Project, { where: { id: projectId }, lock: { mode: 'pessimistic_read' } });
}

/**
 * Locks the rows of the projects for share, in the order of their ids ({@link lockProjectForShare}), for a transaction
 * that then adds rows referencing them under an organization lock (an invitation's acceptance): the projects come first,
 * as the global lock order wants (see `lockOrganization`). SQLite runs one transaction at a time.
 */
export async function lockProjectsForShare(entityManager: EntityManager, projectIds: ReadonlyArray<string>): Promise<void> {
  for (const projectId of Array.from(new Set(projectIds)).sort(byCodeUnits)) {
    await lockProjectForShare(entityManager, projectId);
  }
}

/**
 * Locks the term's row for the rest of the transaction, for a change of its labels that its translations get too. Every
 * write that may add a translation of the term (a first save of its value, a label that adds it) locks the term for share
 * and then reads its labels: this waits for such a write to commit and then sees its translation, and one that starts
 * later waits for this and reads the label. Taken after the project's lock and before the translations'. On Postgres the
 * lock is FOR NO KEY UPDATE, so the foreign-key checks of rows that reference the term (an import adding its
 * translations) are not held up. SQLite takes no row locks: see {@link withTermLabelEditLock}.
 */
export async function lockTerm(entityManager: EntityManager, termId: string): Promise<void> {
  if (isDbType(DbType.BETTER_SQLITE3)) {
    return;
  }
  await entityManager.findOne(Term, {
    where: { id: termId },
    lock: { mode: isDbType(DbType.POSTGRES) ? 'for_no_key_update' : 'pessimistic_write' },
  });
}

/**
 * Runs the work in a transaction whose reads see every row committed before them, as Postgres does by default. MySQL's
 * default (REPEATABLE READ) reads as of the transaction's first read, so a read after a lock wait could miss what the
 * transaction it waited for committed. SQLite takes no isolation level, and runs one transaction at a time.
 */
export function readCommittedTransaction<T>(manager: EntityManager, work: (entityManager: EntityManager) => Promise<T>): Promise<T> {
  return isDbType(DbType.BETTER_SQLITE3) ? manager.transaction(work) : manager.transaction('READ COMMITTED', work);
}

const editLocks = new Map<string, Promise<unknown>>();

/** The one key of the edit locks on SQLite: see {@link translationEditLockKey} */
const SQLITE_EDIT_LOCK_KEY = 'sqlite';

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
  return isDbType(DbType.BETTER_SQLITE3) ? SQLITE_EDIT_LOCK_KEY : `${projectLocaleId}:${termId}`;
}

/**
 * Runs a change of a term's labels that its translations get too after the writes that hold the edit lock of a
 * translation, and before those that ask for it later. Only on SQLite, which takes no row locks: there every such write
 * shares one key, so the change never runs between a write's read of the term's labels and its commit. Elsewhere the
 * change locks the term's row ({@link lockTerm}) and the work runs at once. Taken outside the work's transaction, as the
 * writes take it.
 */
export function withTermLabelEditLock<T>(work: () => Promise<T>): Promise<T> {
  return isDbType(DbType.BETTER_SQLITE3) ? withEditLock(SQLITE_EDIT_LOCK_KEY, work) : work();
}

/** A conflict the database resolved by failing the statement (deadlock, lock wait timeout, busy): a retry can succeed */
export function isTransientDatabaseError(error: any): boolean {
  return ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT', '40P01', '40001', '55P03', 'SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error?.code);
}
