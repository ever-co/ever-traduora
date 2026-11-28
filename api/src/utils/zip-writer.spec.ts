// tslint:disable:no-bitwise (MS-DOS times are packed in bits)
import { PassThrough, Writable } from 'stream';
import { crc32 as zlibCrc32 } from 'zlib';
import { readZip } from '../../test/zip';
import { crc32, dosDateTime, ZipAbortedError, ZipWriter } from './zip-writer';

/** Collects what the writer sends. */
function sink(): { out: PassThrough; bytes: () => Buffer } {
  const out = new PassThrough();
  const chunks: Buffer[] = [];
  out.on('data', chunk => chunks.push(chunk));
  return { out, bytes: () => Buffer.concat(chunks) };
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
    expect(entries.get('empty.json').length).toBe(0);
    expect(zip.size).toBe(5);
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
    expect(bytes().length).toBe(22);
    expect(readZip(bytes()).size).toBe(0);
  });

  it('refuses names that are not relative paths, or come twice', async () => {
    const zip = new ZipWriter(sink().out);
    for (const name of ['', '/etc/passwd', '../x', 'a/../b', 'a//b', 'a\\b']) {
      await expect(zip.add(name, 'x')).rejects.toThrow('not a relative entry name');
    }
    await zip.add('a.json', 'x');
    await expect(zip.add('a.json', 'y')).rejects.toThrow('entry added twice');
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

  it('computes the CRC-32 zlib computes', () => {
    for (const text of ['', 'a', 'The quick brown fox jumps over the lazy dog', 'ü'.repeat(1000)]) {
      const data = Buffer.from(text, 'utf8');
      expect(crc32(data)).toBe(zlibCrc32(data));
    }
  });

  it('writes MS-DOS times in two-second steps', () => {
    const { time, date } = dosDateTime(new Date(Date.UTC(2026, 10, 28, 13, 45, 31)));
    expect(time).toBe((13 << 11) | (45 << 5) | 15);
    expect(date).toBe(((2026 - 1980) << 9) | (11 << 5) | 28);
  });
});
