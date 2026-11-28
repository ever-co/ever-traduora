// tslint:disable:no-bitwise (the ZIP format packs its fields in bits: flags, MS-DOS times)
import { Writable } from 'node:stream';
import { promisify } from 'node:util';
import * as zlib from 'node:zlib';

const deflateRaw = promisify(zlib.deflateRaw);

/**
 * A ZIP archive written entry by entry to a stream (an HTTP response): only the entry being added is in memory
 * (`add`), or only a chunk of it (`addStream`, whose data is compressed as it comes and followed by a data descriptor),
 * plus the central directory (a few dozen bytes per entry) until the end. Entries are DEFLATE-compressed, with UTF-8
 * names. Plain ZIP, without the ZIP64 extensions: an archive stops with `ZipLimitError` before it would pass 65,534
 * entries or 4 GiB, and the caller then breaks the download off rather than send a truncated file.
 *
 * Format: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local file header), 4.3.9 (data descriptor), 4.3.12 (central directory
 * header) and 4.3.16 (end of central directory record).
 */

/** The archive would need ZIP64 (more than 65,534 entries, or more than 4 GiB). */
export class ZipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ZipLimitError';
  }
}

/** The stream closed (the client went away) before the archive was finished. */
export class ZipAbortedError extends Error {
  constructor() {
    super('the archive stream closed before the archive was finished');
    this.name = 'ZipAbortedError';
  }
}

/** 0xFFFF in the end record means "see ZIP64" to some readers: one less is the most a plain archive holds. */
export const MAX_ENTRIES = 0xfffe;
const MAX_OFFSET = 0xffffffff;
const VERSION = 20; // 2.0: DEFLATE
const UTF8_NAMES = 0x0800; // general purpose bit 11
const DATA_DESCRIPTOR = 0x0008; // general purpose bit 3: CRC and sizes follow the data
const DEFLATE = 8;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** The CRC-32 zlib computes, in JavaScript: for Node before 22.2, which has no `zlib.crc32`. */
export function crc32Fallback(data: Buffer, initial = 0): number {
  let crc = (initial ^ 0xffffffff) >>> 0;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const nativeCrc32 = (zlib as unknown as { crc32?: (data: Buffer, value?: number) => number }).crc32;

/** The CRC-32 of ZIP (IEEE 802.3, as zlib computes it), continuing from `initial`: `zlib.crc32` where Node has it. */
export function crc32(data: Buffer, initial = 0): number {
  return typeof nativeCrc32 === 'function' ? nativeCrc32(data, initial) >>> 0 : crc32Fallback(data, initial);
}

/** MS-DOS time and date of `date` (UTC, two-second steps), as ZIP headers hold them. */
export function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.min(Math.max(date.getUTCFullYear(), 1980), 2107);
  return {
    time: (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | Math.floor(date.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate(),
  };
}

interface CentralRecord {
  name: Buffer;
  flags: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

const toBuffer = (chunk: string | Buffer) => (Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'utf8'));

export class ZipWriter {
  private readonly entries: CentralRecord[] = [];
  private readonly names = new Set<string>();
  private offset = 0;
  private finished = false;
  private readonly stamp: { time: number; date: number };

  constructor(
    private readonly out: Writable,
    modified: Date = new Date(),
  ) {
    this.stamp = dosDateTime(modified);
  }

  /** The number of entries added so far. */
  get size(): number {
    return this.entries.length;
  }

  /** Adds one file whose content is at hand. `name` is a relative path with `/` separators, never given twice. */
  async add(name: string, content: string | Buffer): Promise<void> {
    const nameBytes = this.claim(name);
    const data = toBuffer(content);
    const compressed = await deflateRaw(data);
    const record: CentralRecord = {
      name: nameBytes,
      flags: UTF8_NAMES,
      crc: crc32(data),
      compressedSize: compressed.length,
      size: data.length,
      offset: this.offset,
    };
    this.assertFits(data.length, 30 + nameBytes.length + compressed.length);
    this.entries.push(record);
    await this.write(this.localHeader(record));
    await this.write(compressed);
  }

  /**
   * Adds one file whose content comes in chunks, compressed as they come: only a chunk is in memory at a time. The CRC
   * and the sizes follow the data, in a data descriptor (general purpose bit 3).
   */
  async addStream(name: string, chunks: AsyncIterable<string | Buffer> | Iterable<string | Buffer>): Promise<void> {
    const nameBytes = this.claim(name);
    const record: CentralRecord = { name: nameBytes, flags: UTF8_NAMES | DATA_DESCRIPTOR, crc: 0, compressedSize: 0, size: 0, offset: this.offset };
    this.assertFits(0, 30 + nameBytes.length);
    this.entries.push(record);
    await this.write(this.localHeader(record));

    const deflater = zlib.createDeflateRaw();
    const written = (async () => {
      for await (const piece of deflater) {
        record.compressedSize += piece.length;
        this.assertFits(record.size, piece.length);
        await this.write(piece);
      }
    })();
    // A failure on the way out (the client left) must not leave the input waiting for the compressor to drain
    written.catch(() => undefined);
    try {
      for await (const chunk of chunks) {
        const data = toBuffer(chunk);
        record.crc = crc32(data, record.crc);
        record.size += data.length;
        this.assertFits(record.size, 0);
        if (!deflater.write(data)) {
          await Promise.race([new Promise(resolve => deflater.once('drain', resolve)), written]);
        }
      }
      deflater.end();
      await written;
    } catch (error) {
      deflater.destroy();
      throw error;
    }

    const descriptor = Buffer.alloc(16);
    descriptor.writeUInt32LE(0x08074b50, 0);
    descriptor.writeUInt32LE(record.crc, 4);
    descriptor.writeUInt32LE(record.compressedSize, 8);
    descriptor.writeUInt32LE(record.size, 12);
    this.assertFits(record.size, descriptor.length);
    await this.write(descriptor);
  }

  /** Writes the central directory and the end record, then ends the stream. */
  async finish(): Promise<void> {
    if (this.finished) {
      return;
    }
    this.finished = true;
    const directoryOffset = this.offset;
    for (const entry of this.entries) {
      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(VERSION, 4); // made by: 2.0, MS-DOS attributes
      header.writeUInt16LE(VERSION, 6);
      header.writeUInt16LE(entry.flags, 8);
      header.writeUInt16LE(DEFLATE, 10);
      header.writeUInt16LE(this.stamp.time, 12);
      header.writeUInt16LE(this.stamp.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressedSize, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      // Extra field, comment, disk number, internal and external attributes: none
      header.writeUInt32LE(entry.offset, 42);
      this.assertFits(0, header.length + entry.name.length);
      await this.write(Buffer.concat([header, entry.name]));
    }
    const directorySize = this.offset - directoryOffset;
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(directoryOffset, 16);
    this.assertFits(0, end.length);
    await this.write(end);
    await this.end();
  }

  /** The entry's name as bytes, once it is known to be a new, relative path and the archive has room for it. */
  private claim(name: string): Buffer {
    if (this.finished) {
      throw new Error('the archive is finished');
    }
    if (!name || name.startsWith('/') || name.split('/').some(part => part === '..' || part === '') || name.includes('\\')) {
      throw new Error(`not a relative entry name: ${name}`);
    }
    if (this.names.has(name)) {
      throw new Error(`entry added twice: ${name}`);
    }
    if (this.entries.length >= MAX_ENTRIES) {
      throw new ZipLimitError(`an archive holds at most ${MAX_ENTRIES} entries without ZIP64`);
    }
    this.names.add(name);
    return Buffer.from(name, 'utf8');
  }

  /** Refuses an entry of `size` bytes, or `adding` more bytes of the archive, that would need ZIP64. */
  private assertFits(size: number, adding: number): void {
    if (size > MAX_OFFSET || this.offset + adding > MAX_OFFSET) {
      throw new ZipLimitError('an archive holds at most 4 GiB without ZIP64');
    }
  }

  private localHeader(record: CentralRecord): Buffer {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(record.flags, 6);
    header.writeUInt16LE(DEFLATE, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    // With a data descriptor, the CRC and the sizes are 0 here
    header.writeUInt32LE(record.crc, 14);
    header.writeUInt32LE(record.compressedSize, 18);
    header.writeUInt32LE(record.size, 22);
    header.writeUInt16LE(record.name.length, 26);
    header.writeUInt16LE(0, 28);
    return Buffer.concat([header, record.name]);
  }

  /** Ends the stream; refuses (ZipAbortedError) when it closes before everything was flushed. */
  private end(): Promise<void> {
    const out = this.out;
    return new Promise<void>((resolve, reject) => {
      const settle = (error?: Error) => {
        out.off('finish', onFinish);
        out.off('close', onClose);
        out.off('error', onError);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onFinish = () => settle();
      const onClose = () => (out.writableFinished ? settle() : settle(new ZipAbortedError()));
      const onError = (error: Error) => settle(error);
      out.on('finish', onFinish);
      out.on('close', onClose);
      out.on('error', onError);
      out.end();
    });
  }

  /** Writes a chunk, waiting while the stream asks to (backpressure); refuses once the stream closed. */
  private write(chunk: Buffer): Promise<void> {
    const out = this.out;
    if (out.destroyed || out.writableEnded) {
      return Promise.reject(new ZipAbortedError());
    }
    this.offset += chunk.length;
    if (out.write(chunk)) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const settle = (error?: Error) => {
        out.off('drain', onDrain);
        out.off('close', onClose);
        out.off('error', onError);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };
      const onDrain = () => settle();
      const onClose = () => settle(new ZipAbortedError());
      const onError = (error: Error) => settle(error);
      out.on('drain', onDrain);
      out.on('close', onClose);
      out.on('error', onError);
    });
  }
}
