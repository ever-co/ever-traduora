import { DataSource, EntityManager } from 'typeorm';

/**
 * Makes the transactions started from the data source run one after another, whatever their write path. For SQLite:
 * TypeORM shares its single connection between all transactions, so two transactions open at once nest into each
 * other (the second becomes a savepoint of the first), and either can then commit or roll back the other's work. A
 * transaction started inside another one (from the entity manager it is given) is not affected.
 */
export function serializeTransactions(dataSource: DataSource): DataSource {
  const manager = dataSource.manager;
  const transaction: (...args: unknown[]) => Promise<unknown> = manager.transaction.bind(manager);
  let previous: Promise<unknown> = Promise.resolve();

  manager.transaction = ((...args: unknown[]) => {
    const run = previous.then(() => transaction(...args));
    // The next transaction waits for this one, whether it commits or rolls back
    previous = run.catch(() => undefined);
    return run;
  }) as EntityManager['transaction'];

  return dataSource;
}
