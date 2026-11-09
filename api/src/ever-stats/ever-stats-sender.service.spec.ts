import * as nock from 'nock';
import { describeOnSqlite } from '../../test/memory-database';
import { StatsHarness, statsHarness } from '../../test/ever-stats-unit';
import { config, readEverPlatformConfig } from '../config';
import { EverStatsReport } from '../entity/ever-stats-report.entity';
import { verifyBytes } from '../ever-instance/key-wrap';
import * as vendoredConstants from './schema/constants.json';
import { classifyAnswer, defaultStatsFetch } from './ever-stats-sender.service';

const constants = vendoredConstants as any;

describe('answers of Ever Platform', () => {
  it('records 202 as sent, 422 as refused until an upgrade, 409 with a hint, 429/5xx/no answer for a retry', () => {
    expect(classifyAnswer(202)).toEqual({ status: 'sent', retry: 'none', hint: null });
    expect(classifyAnswer(422)).toEqual({ status: 'rejected', retry: 'module_upgrade', hint: null });
    expect(classifyAnswer(409)).toEqual({ status: 'rejected', retry: 'next_day', hint: 'reset_identity' });
    expect(classifyAnswer(429)).toEqual({ status: 'failed', retry: 'backoff', hint: null });
    expect(classifyAnswer(503)).toEqual({ status: 'failed', retry: 'backoff', hint: null });
    expect(classifyAnswer(null)).toEqual({ status: 'failed', retry: 'backoff', hint: null });
    expect(classifyAnswer(400)).toEqual({ status: 'failed', retry: 'next_day', hint: null });
  });
});

describeOnSqlite('EverStatsSenderService', () => {
  let h: StatsHarness;

  beforeEach(async () => {
    h = await statsHarness();
  });

  afterEach(async () => {
    nock.cleanAll();
    nock.enableNetConnect();
    await h.close();
  });

  const stored = () => h.dataSource.getRepository(EverStatsReport).find({ order: { createdAt: 'ASC' } });

  it('posts the exact stored bytes, signed with the statistics key, with the vendored header names', async () => {
    const { row, retry } = await h.sender.send({ period: '2026-11', final: false });
    expect(row.status).toBe('sent');
    expect(retry).toBe('none');
    expect(h.requests).toHaveLength(1);
    const [request] = h.requests;
    expect(request.url).toBe('http://127.0.0.1:9/v1/stats/reports');
    const record = await h.instance.ensure();
    expect(Object.keys(request.headers).sort()).toEqual(
      ['Content-Type', 'User-Agent', constants.stats_headers.key, constants.stats_headers.signature, constants.stats_headers.key_id].sort(),
    );
    expect(request.headers[constants.stats_headers.key]).toBe(record.statsPublicKey);
    expect(request.headers[constants.stats_headers.key_id]).toBe(record.statsKeyId);
    expect(request.headers['User-Agent']).toBe(`ever-connect-sdk/${constants.contracts_version} (traduora/0.23.0)`);
    const signature = request.headers[constants.stats_headers.signature];
    expect(signature.startsWith('ed25519=')).toBe(true);
    const raw = Buffer.from(signature.slice('ed25519='.length), 'base64url');
    expect(verifyBytes(record.statsPublicKey, request.body, raw)).toBe(true);
    const tampered = Buffer.from(request.body);
    tampered[20] = tampered[20] === 0x20 ? 0x21 : 0x20;
    expect(verifyBytes(record.statsPublicKey, tampered, raw)).toBe(false);
    const [kept] = await stored();
    expect(kept.payload).toBe(request.body.toString('utf8'));
    expect(kept.signature).toBe(signature);
    expect(kept.httpStatus).toBe(202);
    expect(kept.sentAt).toBeInstanceOf(Date);
  });

  it.each([
    [422, 'rejected', 'module_upgrade', null],
    [409, 'rejected', 'next_day', 'reset_identity'],
    [503, 'failed', 'backoff', null],
    [429, 'failed', 'backoff', null],
  ])('records an answer %s as %s', async (status, expected, retry, hint) => {
    h.answer.status = status;
    const result = await h.sender.send({ period: '2026-11', final: false });
    expect(result.retry).toBe(retry);
    const [kept] = await stored();
    expect(kept).toMatchObject({ status: expected, httpStatus: status, hint, error: `http_${status}`, sentAt: null });
  });

  it('records no answer as a connection error', async () => {
    h.answer.status = null;
    const result = await h.sender.send({ period: '2026-11', final: false });
    expect(result.retry).toBe('backoff');
    expect((await stored())[0]).toMatchObject({ status: 'failed', httpStatus: null, error: 'connection_error' });
  });

  it('keeps the last 12 reports: the 13th deletes the oldest', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 13; i++) {
      h.clock.now += 1000;
      ids.push((await h.sender.send({ period: '2026-11', final: false })).row.id);
    }
    const kept = await stored();
    expect(kept).toHaveLength(12);
    expect(kept.map(row => row.id)).toEqual(ids.slice(1));
    expect((await h.sender.reports(12)).map(row => row.id)).toEqual(ids.slice(1).reverse());
    expect(await h.sender.reports(3)).toHaveLength(3);
  });

  it('sends nothing to a plain http address outside the local network', async () => {
    const insecure = readEverPlatformConfig({ TR_EVER_STATS_API_URL: 'http://example.com' }, () => undefined);
    expect(insecure.statsApiUrl).toBeNull();
    h.settings.apiUrl = 'http://example.com';
    const result = await h.sender.send({ period: '2026-11', final: false });
    expect(h.requests).toHaveLength(0);
    expect(result.row).toMatchObject({ status: 'failed', error: 'api_url_unusable' });
  });

  it('sends nothing without TR_SECRET, and says why', async () => {
    config.everPlatform.secretConfigured = false;
    const result = await h.sender.send({ period: '2026-11', final: false });
    expect(h.requests).toHaveLength(0);
    expect(result.row).toMatchObject({ status: 'failed', error: 'secret_missing', hint: 'set_secret' });
  });

  it('never keeps a report of an identity that was reset while it was being sent', async () => {
    const before = await h.instance.ensure();
    h.answer.status = () => {
      // The operator resets the identity while the request is in flight
      void h.instance.resetIdentity('operator');
      return 202;
    };
    await h.sender.send({ period: '2026-11', final: false });
    await new Promise(resolve => setTimeout(resolve, 50));
    const after = await h.instance.ensure();
    expect(after.instanceId).not.toBe(before.instanceId);
    expect((await stored()).filter(row => row.instanceId === before.instanceId)).toEqual([]);
    expect(await h.sender.reports()).toEqual([]);
  });

  describe('HTTP client', () => {
    it('posts the body unchanged and follows no redirect', async () => {
      const seen: string[] = [];
      nock.disableNetConnect();
      nock('http://stats.example.test')
        .post('/v1/stats/reports', body => {
          seen.push(JSON.stringify(body));
          return true;
        })
        .reply(302, '', { Location: 'http://elsewhere.example.test/v1/stats/reports' });
      const target = nock('http://elsewhere.example.test').post('/v1/stats/reports').reply(202);
      const answer = await defaultStatsFetch('http://stats.example.test/v1/stats/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from('{"a":1}'),
      });
      expect(answer.status).toBe(302);
      expect(seen).toEqual(['{"a":1}']);
      expect(target.isDone()).toBe(false);
    });

    it('rejects when nothing answers', async () => {
      nock.disableNetConnect();
      await expect(
        defaultStatsFetch('http://stats.example.test/v1/stats/reports', { method: 'POST', headers: {}, body: Buffer.from('{}') }),
      ).rejects.toBeDefined();
    });
  });
});
