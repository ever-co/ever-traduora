import { createHash } from 'crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

interface VendorFile {
  path: string;
  source: string;
  sha256: string;
}

const DIR = __dirname;
const vendor = JSON.parse(readFileSync(join(DIR, 'VENDOR.json'), 'utf8')) as {
  source: { repository: string; commit: string; contracts_version: string };
  files: VendorFile[];
};

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Every vendored JSON file under this folder, relative, with `/` separators. */
function vendoredFiles(dir = DIR, prefix = ''): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort(byText)) {
    const rel = prefix ? `${prefix}/${name}` : name;
    if (statSync(join(dir, name)).isDirectory()) {
      out.push(...vendoredFiles(join(dir, name), rel));
    } else if (name.endsWith('.json') && name !== 'VENDOR.json') {
      out.push(rel);
    }
  }
  return out;
}

/** The files whose bytes differ from the hashes VENDOR.json records. */
export function driftedFiles(read: (path: string) => Buffer = p => readFileSync(join(DIR, p))): string[] {
  return vendor.files.filter(file => sha256(read(file.path)) !== file.sha256).map(file => file.path);
}

describe('vendored statistics contract (drift)', () => {
  it('names its public source', () => {
    expect(vendor.source.repository).toBe('ever-co/ever-connect-sdk');
    expect(vendor.source.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it('records every vendored file', () => {
    expect(vendor.files.map(file => file.path).sort(byText)).toEqual(vendoredFiles());
  });

  it('has the bytes VENDOR.json records', () => {
    expect(driftedFiles()).toEqual([]);
  });

  it('notices one changed byte (control)', () => {
    const changed = driftedFiles(path => {
      const bytes = Buffer.from(readFileSync(join(DIR, path)));
      if (path === 'ever.stats.v1.json') bytes[10] = bytes[10] ^ 0x01;
      return bytes;
    });
    expect(changed).toEqual(['ever.stats.v1.json']);
  });

  it('records the contract version of constants.json', () => {
    const constants = JSON.parse(readFileSync(join(DIR, 'constants.json'), 'utf8'));
    expect(constants.contracts_version).toBe(vendor.source.contracts_version);
  });

  // In CI, EVER_CONNECT_SDK_DIR points at a checkout of the public SDK at the recorded commit: every vendored file must
  // be byte for byte the SDK's own.
  const sdkDir = process.env.EVER_CONNECT_SDK_DIR;
  (sdkDir ? it : it.skip)('equals the SDK checkout in EVER_CONNECT_SDK_DIR', () => {
    const differing = vendor.files.filter(file => {
      const source = join(sdkDir, file.source);
      return !existsSync(source) || sha256(readFileSync(source)) !== sha256(readFileSync(join(DIR, file.path)));
    });
    expect(differing.map(file => file.path)).toEqual([]);
  });
});
