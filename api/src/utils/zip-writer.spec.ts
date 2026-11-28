// tslint:disable:no-bitwise (MS-DOS times are packed in bits)
import { randomBytes } from 'node:crypto';
import { PassThrough, Writable } from 'node:stream';
import { readZip } from '../../test/zip';
import { crc32, crc32Fallback, dosDateTime, MAX_ENTRIES, ZipAbortedError, ZipLimitError, ZipWriter } from './zip-writer';

/** Collects what the writer sends. */
function sink(): { out: PassThrough; bytes: () => Buffer } {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', chunk => chunks.push(chunk));
  return { out, bytes: () => Buffer.concat(chunks) };
}

async function* pieces(...parts: string[]): AsyncGenerator<string> {
  for (const part of parts) {
    await new Promise(resolve => setImmediate(resolve));
    yield part;
  }
}

describe('ZipWriter', () => {
  it('writes an archive an unzip tool reads back, entry by entry, with UTF-8 names', async () => {
    const { out, bytes } = sink();
    const zip = new ZipWriter(out, new Date(Date.UTC(2026, 10, 28, 13, 45, 31)));
    await zip.add('organization.json', JSON.stringify({ name: 'Acme' }));
    await zip.add('projects/web-1/translations/de.json', '{"hello": "hallo"}');
    await zip.add('projects/web-1/translations/ja.json', Buffer.from('{"hello": "こんにちは"}', 'utf8'));
    await zip.add('empty.json', '');
    await zip.add('größe/ü.json', 'ü');
    await zip.finish();

    const entries = readZip(bytes());
    expect([...entries.keys()]).toEqual([
      'organization.json',
      'projects/web-1/translations/de.json',
      'projects/web-1/translations/ja.json',
      'empty.json',
      'größe/ü.json',
    ]);
    expect(entries.get('projects/web-1/translations/ja.json').toString('utf8')).toBe('{"hello": "こんにちは"}');
    expect(entries.get('empty.json')).toHaveLength(0);
    expect(zip.size).toBe(5);
  });

  it('streams an entry chunk by chunk, with its CRC and sizes in a data descriptor', async () => {
    const { out, bytes } = sink();
    const zip = new ZipWriter(out);
    await zip.add('first.json', '[]');
    const big = Array.from({ length: 2000 }, (_, i) => `{"value":"term.${i}"},`);
    await zip.addStream('terms.json', pieces('[', ...big, '{}]'));
    await zip.addStream('empty.json', pieces());
    await zip.add('last.json', '{}');
    await zip.finish();
    const entries = readZip(bytes());
    expect([...entries.keys()]).toEqual(['first.json', 'terms.json', 'empty.json', 'last.json']);
    expect(entries.get('terms.json').toString('utf8')).toBe(['[', ...big, '{}]'].join(''));
    expect(entries.get('empty.json')).toHaveLength(0);
    expect(bytes().length).toBeLessThan(entries.get('terms.json').length / 3);
  });

  it('compresses a large entry', async () => {
    const { out, bytes } = sink();
    const zip = new ZipWriter(out);
    const big = JSON.stringify(Object.fromEntries(Array.from({ length: 5000 }, (_, i) => [`term.${i}`, `translation ${i}`])));
    await zip.add('big.json', big);
    await zip.finish();
    const archive = bytes();
    expect(archive.length).toBeLessThan(big.length / 3);
    expect(readZip(archive).get('big.json').toString('utf8')).toBe(big);
  });

  it('writes an empty archive as just the end record', async () => {
    const { out, bytes } = sink();
    await new ZipWriter(out).finish();
    expect(bytes()).toHaveLength(22);
    expect(readZip(bytes()).size).toBe(0);
  });

  it('refuses names that are not relative paths, or come twice', async () => {
    const zip = new ZipWriter(sink().out);
    for (const name of ['', '/etc/passwd', '../x', 'a/../b', 'a//b', 'a\\b']) {
      await expect(zip.add(name, 'x')).rejects.toThrow('not a relative entry name');
    }
    await zip.add('a.json', 'x');
    await expect(zip.add('a.json', 'y')).rejects.toThrow('entry added twice');
    await expect(zip.addStream('a.json', pieces('y'))).rejects.toThrow('entry added twice');
  });

  it('holds at most 65,534 entries, one below the ZIP64 marker', async () => {
    expect(MAX_ENTRIES).toBe(0xfffe);
    const zip = new ZipWriter(new Writable({ write: (_chunk, _encoding, callback) => callback() }));
    await zip.add('first', '');
    // The entries before the last one, without writing 65,533 of them
    const entries = (zip as unknown as { entries: unknown[] }).entries;
    entries.push(...Array.from({ length: MAX_ENTRIES - 2 }, () => entries[0]));
    await zip.add('last', '');
    expect(zip.size).toBe(MAX_ENTRIES);
    await expect(zip.add('one-more', '')).rejects.toBeInstanceOf(ZipLimitError);
  });

  it('waits while the stream asks to, and stops once the stream closed', async () => {
    let release: () => void;
    const held = new Promise<void>(resolve => (release = resolve));
    const slow = new Writable({
      highWaterMark: 16,
      write(_chunk, _encoding, callback) {
        held.then(() => callback());
      },
    });
    const zip = new ZipWriter(slow);
    let added = false;
    const adding = zip.add('a.json', 'x'.repeat(1000)).then(() => (added = true));
    await new Promise(resolve => setImmediate(resolve));
    expect(added).toBe(false);
    release();
    await adding;
    expect(added).toBe(true);

    const closed = new PassThrough();
    closed.destroy();
    await expect(new ZipWriter(closed).add('a.json', 'x')).rejects.toBeInstanceOf(ZipAbortedError);
  });

  it('refuses to finish when the stream closes before it is flushed', async () => {
    const stuck = new Writable({ highWaterMark: 1, write: () => undefined });
    const zip = new ZipWriter(stuck);
    const finishing = zip.finish();
    setImmediate(() => stuck.destroy());
    await expect(finishing).rejects.toBeInstanceOf(ZipAbortedError);
  });

  it('stops a streamed entry when the stream closes on the way', async () => {
    const out = new PassThrough({ highWaterMark: 16 });
    out.resume();
    const zip = new ZipWriter(out);
    async function* endless() {
      for (let index = 0; index < 2_000; index++) {
        if (index === 50) {
          out.destroy();
        }
        await new Promise(resolve => setImmediate(resolve));
        // Data that does not compress, so the compressor sends something on the way
        yield randomBytes(512).toString('hex');
      }
    }
    await expect(zip.addStream('a.json', endless())).rejects.toBeInstanceOf(ZipAbortedError);
  });

  it('computes the standard CRC-32, in one piece or continued', () => {
    // Test vectors of CRC-32/ISO-HDLC (zlib's)
    const vectors: Array<[string, number]> = [
      ['', 0x00000000],
      ['a', 0xe8b7be43],
      ['123456789', 0xcbf43926],
      ['The quick brown fox jumps over the lazy dog', 0x414fa339],
    ];
    for (const [text, expected] of vectors) {
      const data = Buffer.from(text, 'utf8');
      expect([text, crc32(data)]).toEqual([text, expected]);
      expect([text, crc32Fallback(data)]).toEqual([text, expected]);
    }
    const whole = Buffer.from('123456789', 'utf8');
    expect(crc32(whole.subarray(4), crc32(whole.subarray(0, 4)))).toBe(0xcbf43926);
    expect(crc32Fallback(whole.subarray(4), crc32Fallback(whole.subarray(0, 4)))).toBe(0xcbf43926);
  });

  it('writes MS-DOS times in two-second steps', () => {
    const { time, date } = dosDateTime(new Date(Date.UTC(2026, 10, 28, 13, 45, 31)));
    expect(time).toBe((13 << 11) | (45 << 5) | 15);
    expect(date).toBe(((2026 - 1980) << 9) | (11 << 5) | 28);
  });
});
