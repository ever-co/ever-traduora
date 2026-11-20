import { DataSource } from 'typeorm';
import { EverInstance } from '../entity/ever-instance.entity';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { EverInstanceService } from '../ever-instance/ever-instance.service';
import { verifyBytes } from '../ever-instance/key-wrap';
import { EverStatsCollectorService } from './ever-stats-collector.service';
import { EverStatsConfig } from './ever-stats.config';
import { classifyAnswer, EverStatsSenderService, StatsRequest } from './ever-stats-sender.service';

const CONFIG: EverStatsConfig = {
  apiUrl: 'http://mock-platform:8080',
  country: 'ZZ',
  intervalS: 86400,
  installSource: 'self-hosted',
  release: { version: '0.23.0', channel: 'stable' },
  features: { google_login: false, signups_enabled: true },
};

const counting = (total: number) => ({ count: async () => total }) as any;

describe('EverStatsSenderService', () => {
  let dataSource: DataSource;
  let instance: EverInstanceService;
  let requests: Array<{ url: string; init: StatsRequest }>;
  let answer: number | Error;
  let now: number;

  const sender = (config: EverStatsConfig = CONFIG) => {
    const collector = new EverStatsCollectorService(config, counting(2), counting(1), counting(3), counting(4), counting(1), counting(0));
    return new EverStatsSenderService(
      dataSource.getRepository(EverStatsReport),
      config,
      () => now,
      async (url, init) => {
        requests.push({ url, init });
        if (answer instanceof Error) throw answer;
        return { status: answer };
      },
      instance,
      collector,
    );
  };

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [EverInstance, EverStatsReport], synchronize: true });
    await dataSource.initialize();
    instance = new EverInstanceService(dataSource.getRepository(EverInstance), {
      installSource: 'self-hosted',
      adminEmails: ['operator@example.com'],
      secret: 'unit-test-secret-of-this-installation',
    });
    requests = [];
    answer = 202;
    now = Date.UTC(2026, 10, 19, 12);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('posts the signed report once, with the public key and the signature of the exact bytes', async () => {
    const row = await sender().send({ period: '2026-11', final: false });
    expect(row.status).toBe('sent');
    expect(requests).toHaveLength(1);
    const { url, init } = requests[0];
    expect(url).toBe('http://mock-platform:8080/v1/stats/reports');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(init.headers['User-Agent']).toMatch(/^ever-connect-sdk\/\S+ \(traduora\/0\.23\.0\)$/);
    expect(Object.keys(init.headers).some(name => /cookie|authorization/i.test(name))).toBe(false);

    const record = await instance.read();
    expect(init.headers['Ever-Stats-Key']).toBe(record.statsPublicKey);
    expect(init.headers['Ever-Stats-Key-Id']).toBe(record.statsKeyId);
    const signature = init.headers['Ever-Stats-Signature'];
    expect(signature.startsWith('ed25519=')).toBe(true);
    const raw = Buffer.from(signature.slice('ed25519='.length), 'base64url');
    expect(verifyBytes(record.statsPublicKey, init.body, raw)).toBe(true);

    const tampered = Buffer.from(init.body);
    tampered[tampered.length - 2] = tampered[tampered.length - 2] === 0x31 ? 0x32 : 0x31;
    expect(verifyBytes(record.statsPublicKey, tampered, raw)).toBe(false);

    // What is stored is what was sent
    const [stored] = await sender().reports();
    expect(stored.payload).toBe(init.body.toString('utf8'));
    expect(stored.httpStatus).toBe(202);
    expect(stored.sentAt).toBe(now);
  });

  it('records refusals and failures as Ever Platform answered them', async () => {
    answer = 422;
    expect(await sender().send({ period: '2026-11', final: false })).toMatchObject({ status: 'rejected', retry: 'module_upgrade' });
    answer = 409;
    expect(await sender().send({ period: '2026-11', final: false })).toMatchObject({ status: 'rejected', hint: 'reset_identity' });
    answer = 503;
    expect(await sender().send({ period: '2026-11', final: false })).toMatchObject({ status: 'failed', retry: 'backoff', error: 'http_503' });
    answer = new Error('connect ECONNREFUSED');
    expect(await sender().send({ period: '2026-11', final: false })).toMatchObject({ status: 'failed', retry: 'backoff', error: 'connection_error' });
  });

  it('classifies answers', () => {
    expect(classifyAnswer(202).status).toBe('sent');
    expect(classifyAnswer(429)).toEqual({ status: 'failed', retry: 'backoff', hint: null });
    expect(classifyAnswer(400)).toEqual({ status: 'failed', retry: 'next_day', hint: null });
    expect(classifyAnswer(null).retry).toBe('backoff');
  });

  it('keeps the last 12 reports', async () => {
    for (let i = 0; i < 13; i += 1) {
      now += 1000;
      await sender().send({ period: '2026-11', final: false });
    }
    const rows = await dataSource.getRepository(EverStatsReport).find();
    expect(rows).toHaveLength(12);
    expect(Math.min(...rows.map(r => r.createdAt))).toBe(Date.UTC(2026, 10, 19, 12) + 2000);
  });

  it('sends nothing to an address that cannot be used', async () => {
    const row = await sender({ ...CONFIG, apiUrl: null }).send({ period: '2026-11', final: false });
    expect(row).toMatchObject({ status: 'failed', error: 'api_url_unusable' });
    expect(requests).toHaveLength(0);
  });

  it('sends nothing without a configured TR_SECRET', async () => {
    instance = new EverInstanceService(dataSource.getRepository(EverInstance), { installSource: 'self-hosted', adminEmails: [], secret: '' });
    const row = await sender().send({ period: '2026-11', final: false });
    expect(row).toMatchObject({ status: 'failed', error: 'secret_missing' });
    expect(requests).toHaveLength(0);
  });
});
