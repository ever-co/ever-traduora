import { DataSource } from 'typeorm';
import { serializeTransactions } from './serialize-transactions';

describe('serializeTransactions', () => {
  // A data source whose transactions record when they start and end, and yield in between
  function dataSource() {
    const events: string[] = [];
    const yieldToOthers = () => new Promise(resolve => setImmediate(resolve));
    const transaction = jest.fn(async (...args: any[]) => {
      const work = args[args.length - 1];
      events.push('begin');
      try {
        await yieldToOthers();
        return await work('transactional manager');
      } finally {
        events.push('end');
      }
    });
    return { source: serializeTransactions({ manager: { transaction } } as unknown as DataSource), transaction, events };
  }

  it('runs a transaction only after the previous one has ended', async () => {
    const { source, events } = dataSource();

    await Promise.all([1, 2, 3].map(() => source.manager.transaction(async () => undefined)));

    expect(events).toEqual(['begin', 'end', 'begin', 'end', 'begin', 'end']);
  });

  it('starts the next transaction after one that failed, and returns each result or error to its caller', async () => {
    const { source, events } = dataSource();

    const results = await Promise.allSettled([
      source.manager.transaction(async () => {
        throw new Error('rolled back');
      }),
      source.manager.transaction(async manager => `done with ${manager}`),
    ]);

    expect(results).toEqual([
      { status: 'rejected', reason: new Error('rolled back') },
      { status: 'fulfilled', value: 'done with transactional manager' },
    ]);
    expect(events).toEqual(['begin', 'end', 'begin', 'end']);
  });

  it('passes the isolation level on', async () => {
    const { source, transaction } = dataSource();
    const work = async () => undefined;

    await source.manager.transaction('READ COMMITTED', work);

    expect(transaction).toHaveBeenCalledWith('READ COMMITTED', work);
  });
});
