import { DataSource } from 'typeorm';
import { EverConnectAudit } from '../entity/ever-connect-audit.entity';
import { auditHash, EVER_CONNECT_AUDIT_KEPT, EverConnectAuditService } from './ever-connect-audit.service';

describe('EverConnectAuditService', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [EverConnectAudit], synchronize: true });
    await dataSource.initialize();
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('keeps the newest rows only, with a bounded query (MySQL takes no offset without a limit), and stays one chain', async () => {
    const repo = dataSource.getRepository(EverConnectAudit);
    const audit = new EverConnectAuditService(repo);
    // Rows written before (by an older version that kept more): the next write trims them in a bounded batch
    const now = Date.now();
    let prevHash: string | null = null;
    const older: EverConnectAudit[] = [];
    for (let seq = 1; seq <= EVER_CONNECT_AUDIT_KEPT + 3; seq += 1) {
      const row = Object.assign(new EverConnectAudit(), {
        id: `row-${seq}`,
        seq,
        at: now,
        action: 'test',
        actorRef: 'system',
        detail: null,
        prevHash,
      });
      row.hash = auditHash(row);
      prevHash = row.hash;
      older.push(row);
    }
    await repo.save(older, { chunk: 100 });
    const find = jest.spyOn(repo, 'find');

    await audit.record('instance.connect', 'user:u1', null);

    // Every trimming read is limited
    for (const [options] of find.mock.calls) {
      if (options && options.skip !== undefined) {
        expect(options.take).toBeGreaterThan(0);
      }
    }
    expect(await repo.count()).toBe(EVER_CONNECT_AUDIT_KEPT);
    const [newest] = await audit.rows(1);
    expect(newest).toMatchObject({ seq: EVER_CONNECT_AUDIT_KEPT + 4, action: 'instance.connect', prevHash });
    expect(newest.hash).toBe(auditHash(newest));
  });
});
