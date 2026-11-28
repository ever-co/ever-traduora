// tslint:disable:no-bitwise (the ZIP format packs its fields in bits: flags, CRC-32)
import { inflateRawSync } from 'zlib';

/**
 * Reads a ZIP archive the way an unzip tool does, from its end: the end of central directory record, then each central
 * directory header, then the entry's local header and data. For the tests of the organization export only. Checks the
 * structure and each entry's CRC-32 and sizes, and fails on anything it does not expect.
 */
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
    if (archive.readUInt32LE(at) !== 0x02014b50) {
      throw new Error(`no central directory header at ${at}`);
    }
    const flags = archive.readUInt16LE(at + 8);
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const compressedSize = archive.readUInt32LE(at + 20);
    const size = archive.readUInt32LE(at + 24);
    const nameLength = archive.readUInt16LE(at + 28);
    const extraLength = archive.readUInt16LE(at + 30);
    const commentLength = archive.readUInt16LE(at + 32);
    const offset = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;

    if (archive.readUInt32LE(offset) !== 0x04034b50) {
      throw new Error(`no local header for ${name}`);
    }
    const localName = archive.subarray(offset + 30, offset + 30 + archive.readUInt16LE(offset + 26)).toString('utf8');
    if (localName !== name || archive.readUInt32LE(offset + 14) !== crc || archive.readUInt32LE(offset + 18) !== compressedSize) {
      throw new Error(`the local header of ${name} differs from its central directory header`);
    }
    const dataAt = offset + 30 + archive.readUInt16LE(offset + 26) + archive.readUInt16LE(offset + 28);
    const raw = archive.subarray(dataAt, dataAt + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : method === 0 ? raw : null;
    if (!data) {
      throw new Error(`unknown compression method ${method} for ${name}`);
    }
    if (data.length !== size || crc32(data) !== crc) {
      throw new Error(`${name}: size or CRC-32 does not match`);
    }
    if (!(flags & 0x0800) && /[^\x20-\x7e]/.test(name)) {
      throw new Error(`${name}: a non-ASCII name without the UTF-8 flag`);
    }
    if (entries.has(name)) {
      throw new Error(`${name} is in the archive twice`);
    }
    entries.set(name, data);
  }
  return entries;
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
