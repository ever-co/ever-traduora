// tslint:disable:no-bitwise (the ZIP format packs its fields in bits: CRC-32, MS-DOS times)
import { Writable } from 'stream';
import { promisify } from 'util';
import { deflateRaw as deflateRawCallback } from 'zlib';

const deflateRaw = promisify(deflateRawCallback);

/**
 * A ZIP archive written entry by entry to a stream (an HTTP response): only the entry being added is in memory, and the
 * central directory (a few dozen bytes per entry) until the end. Entries are DEFLATE-compressed, with UTF-8 names. Plain
 * ZIP, without the ZIP64 extensions: an archive stops with `ZipLimitError` before it would pass 65,535 entries or 4 GiB,
 * and the caller then breaks the download off rather than send a truncated file.
 *
 * Format: PKWARE APPNOTE 6.3.x, sections 4.3.7 (local file header), 4.3.12 (central directory header) and 4.3.16 (end of
 * central directory record).
 */

/** The archive would need ZIP64 (more than 65,535 entries, or more than 4 GiB). */
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

const MAX_ENTRIES = 0xffff;
const MAX_OFFSET = 0xffffffff;
const VERSION = 20; // 2.0: DEFLATE
const UTF8_NAMES = 0x0800; // general purpose bit 11
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

/** The CRC-32 of ZIP (IEEE 802.3, reflected, as zlib computes it). */
export function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
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
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
}

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

  /** Adds one file. `name` is a relative path with `/` separators; a name given twice is refused. */
  async add(name: string, content: string | Buffer): Promise<void> {
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
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const compressed = await deflateRaw(data);
    const nameBytes = Buffer.from(name, 'utf8');
    const record: CentralRecord = { name: nameBytes, crc: crc32(data), compressedSize: compressed.length, size: data.length, offset: this.offset };
    if (data.length > MAX_OFFSET || this.offset + 30 + nameBytes.length + compressed.length > MAX_OFFSET) {
      throw new ZipLimitError('an archive holds at most 4 GiB without ZIP64');
    }

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(VERSION, 4);
    header.writeUInt16LE(UTF8_NAMES, 6);
    header.writeUInt16LE(DEFLATE, 8);
    header.writeUInt16LE(this.stamp.time, 10);
    header.writeUInt16LE(this.stamp.date, 12);
    header.writeUInt32LE(record.crc, 14);
    header.writeUInt32LE(record.compressedSize, 18);
    header.writeUInt32LE(record.size, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    this.names.add(name);
    this.entries.push(record);
    await this.write(Buffer.concat([header, nameBytes]));
    await this.write(compressed);
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
      header.writeUInt16LE(UTF8_NAMES, 8);
      header.writeUInt16LE(DEFLATE, 10);
      header.writeUInt16LE(this.stamp.time, 12);
      header.writeUInt16LE(this.stamp.date, 14);
      header.writeUInt32LE(entry.crc, 16);
      header.writeUInt32LE(entry.compressedSize, 20);
      header.writeUInt32LE(entry.size, 24);
      header.writeUInt16LE(entry.name.length, 28);
      // Extra field, comment, disk number, internal and external attributes: none
      header.writeUInt32LE(entry.offset, 42);
      await this.write(Buffer.concat([header, entry.name]));
    }
    const directorySize = this.offset - directoryOffset;
    if (this.offset > MAX_OFFSET) {
      throw new ZipLimitError('an archive holds at most 4 GiB without ZIP64');
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.entries.length, 8);
    end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(directorySize, 12);
    end.writeUInt32LE(directoryOffset, 16);
    await this.write(end);
    await new Promise<void>((resolve, reject) => {
      this.out.once('error', reject);
      this.out.end(() => resolve());
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
