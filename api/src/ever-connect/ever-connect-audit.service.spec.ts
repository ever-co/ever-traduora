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

  it('keeps the newest rows only, trimming with a bounded query (MySQL takes no offset without a limit), as one chain', async () => {
    const repo = dataSource.getRepository(EverConnectAudit);
    const audit = new EverConnectAuditService(repo);
    // Rows written before (a backlog larger than one trimming batch): each write trims at most 100 of them
    const now = Date.now();
    let prevHash: string | null = null;
    const older: EverConnectAudit[] = [];
    for (let seq = 1; seq <= 650; seq += 1) {
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
    const trimming = find.mock.calls.map(([options]) => options).filter(options => options && options.skip !== undefined);
    expect(trimming.length).toBeGreaterThan(0);
    for (const options of trimming) {
      expect(options.take).toBeGreaterThan(0);
      expect(options.take).toBeLessThanOrEqual(100);
    }
    expect(await repo.count()).toBe(551);

    await audit.record('instance.disconnect', 'user:u1', null);
    expect(await repo.count()).toBe(EVER_CONNECT_AUDIT_KEPT);

    // The kept rows are still one chain, and an edited row shows
    const kept = await repo.find({ order: { seq: 'ASC' } });
    expect(kept[kept.length - 1]).toMatchObject({ seq: 652, action: 'instance.disconnect' });
    for (let index = 0; index < kept.length; index += 1) {
      expect(kept[index].hash).toBe(auditHash(kept[index]));
      if (index > 0) {
        expect(kept[index].prevHash).toBe(kept[index - 1].hash);
      }
    }
    expect(auditHash({ ...kept[0], detail: 'edited' })).not.toBe(kept[0].hash);
  });
});
