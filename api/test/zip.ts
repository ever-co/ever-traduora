// tslint:disable:no-bitwise (the ZIP format packs its fields in bits: flags, CRC-32)
import { inflateRawSync } from 'node:zlib';

/**
 * Reads a ZIP archive the way an unzip tool does, from its end: the end of central directory record, then each central
 * directory header, then the entry's local header and data (and its data descriptor, when general purpose bit 3 is
 * set). For the tests of the organization export only. Checks the structure and each entry's CRC-32 and sizes, and
 * fails on anything it does not expect.
 */

const DATA_DESCRIPTOR = 0x0008;
const UTF8_NAMES = 0x0800;

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  offset: number;
  /** Where the next central directory header starts */
  next: number;
}

export function readZip(archive: Buffer): Map<string, Buffer> {
  const endAt = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || archive.length - endAt !== 22) {
    throw new Error('no end of central directory record at the end of the archive');
  }
  const count = archive.readUInt16LE(endAt + 10);
  const directorySize = archive.readUInt32LE(endAt + 12);
  let at = archive.readUInt32LE(endAt + 16);
  if (at + directorySize !== endAt || archive.readUInt16LE(endAt + 8) !== count) {
    throw new Error('the central directory does not end where the end record starts');
  }
  const entries = new Map<string, Buffer>();
  for (let index = 0; index < count; index++) {
    const entry = centralEntry(archive, at);
    at = entry.next;
    if (entries.has(entry.name)) {
      throw new Error(`${entry.name} is in the archive twice`);
    }
    entries.set(entry.name, entryData(archive, entry));
  }
  return entries;
}

function centralEntry(archive: Buffer, at: number): CentralEntry {
  if (archive.readUInt32LE(at) !== 0x02014b50) {
    throw new Error(`no central directory header at ${at}`);
  }
  const nameLength = archive.readUInt16LE(at + 28);
  const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
  const flags = archive.readUInt16LE(at + 8);
  if (!(flags & UTF8_NAMES) && /[^\x20-\x7e]/.test(name)) {
    throw new Error(`${name}: a non-ASCII name without the UTF-8 flag`);
  }
  return {
    name,
    flags,
    method: archive.readUInt16LE(at + 10),
    crc: archive.readUInt32LE(at + 16),
    compressedSize: archive.readUInt32LE(at + 20),
    size: archive.readUInt32LE(at + 24),
    offset: archive.readUInt32LE(at + 42),
    next: at + 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32),
  };
}

/** The entry's data, checked against its local header, its data descriptor and its CRC-32. */
function entryData(archive: Buffer, entry: CentralEntry): Buffer {
  const at = entry.offset;
  if (archive.readUInt32LE(at) !== 0x04034b50) {
    throw new Error(`no local header for ${entry.name}`);
  }
  const nameLength = archive.readUInt16LE(at + 26);
  const localName = archive.subarray(at + 30, at + 30 + nameLength).toString('utf8');
  const localFlags = archive.readUInt16LE(at + 6);
  if (localName !== entry.name || localFlags !== entry.flags) {
    throw new Error(`the local header of ${entry.name} differs from its central directory header`);
  }
  const dataAt = at + 30 + nameLength + archive.readUInt16LE(at + 28);
  const described = (entry.flags & DATA_DESCRIPTOR) !== 0;
  // With a data descriptor the local header holds zeros; the descriptor after the data holds the values
  const [crc, compressedSize, size] = described
    ? descriptorAt(archive, dataAt + entry.compressedSize, entry.name)
    : [archive.readUInt32LE(at + 14), archive.readUInt32LE(at + 18), archive.readUInt32LE(at + 22)];
  if (crc !== entry.crc || compressedSize !== entry.compressedSize || size !== entry.size) {
    throw new Error(`${entry.name}: the local header or data descriptor differs from the central directory`);
  }
  const data = uncompressed(archive.subarray(dataAt, dataAt + entry.compressedSize), entry);
  if (data.length !== entry.size || crc32(data) !== entry.crc) {
    throw new Error(`${entry.name}: size or CRC-32 does not match`);
  }
  return data;
}

function descriptorAt(archive: Buffer, at: number, name: string): [number, number, number] {
  if (archive.readUInt32LE(at) !== 0x08074b50) {
    throw new Error(`no data descriptor after ${name}`);
  }
  return [archive.readUInt32LE(at + 4), archive.readUInt32LE(at + 8), archive.readUInt32LE(at + 12)];
}

function uncompressed(raw: Buffer, entry: CentralEntry): Buffer {
  if (entry.method === 8) {
    return inflateRawSync(raw);
  }
  if (entry.method === 0) {
    return raw;
  }
  throw new Error(`unknown compression method ${entry.method} for ${entry.name}`);
}

/** The entry as parsed JSON. */
export function zipJson<T = any>(entries: Map<string, Buffer>, name: string): T {
  const entry = entries.get(name);
  if (!entry) {
    throw new Error(`no entry ${name}; the archive has ${[...entries.keys()].join(', ')}`);
  }
  return JSON.parse(entry.toString('utf8'));
}

/** CRC-32 written here again, bit by bit, so that the reader does not trust the writer's table. */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
