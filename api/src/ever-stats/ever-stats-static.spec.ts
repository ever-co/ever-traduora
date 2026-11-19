import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

const SRC = join(__dirname, '..');

/** Every TypeScript source file under `dir` (specs included), as paths relative to `api/src` with `/` separators. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      out.push(...sources(path));
    } else if (name.endsWith('.ts')) {
      out.push(relative(SRC, path).split(sep).join('/'));
    }
  }
  return out;
}

const read = (path: string) => readFileSync(join(SRC, path), 'utf8');
const MODULE_DIRS = ['ever-instance/', 'ever-stats/', 'ever-platform/', 'ever-connect/'];
const inModule = (path: string) => MODULE_DIRS.some(dir => path.startsWith(dir));
const isSpec = (path: string) => path.endsWith('.spec.ts');

describe('anonymous statistics: static checks', () => {
  const all = sources(SRC);
  const moduleFiles = all.filter(path => inModule(path) && !isSpec(path));

  it('never decides anything from the host name, the Docker flag or the database type', () => {
    const offenders = moduleFiles.filter(path => /TR_VIRTUAL_HOST|IS_DOCKER|TR_DB_TYPE|virtualHost|db\.default\.type/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('has no HTTP client in the instance identity', () => {
    const offenders = moduleFiles
      .filter(path => path.startsWith('ever-instance/'))
      .filter(path => /from '(http|https|axios|@nestjs\/axios)'|fetch\(/.test(read(path)));
    expect(offenders).toEqual([]);
  });

  it('makes its one request only from the sender', () => {
    const offenders = moduleFiles.filter(
      path => /from '(http|https|axios|@nestjs\/axios)'/.test(read(path)) && path !== 'ever-stats/ever-stats-sender.service.ts',
    );
    expect(offenders).toEqual([]);
  });

  it('reaches Ever Platform from the connection only through the SDK client, in one file', () => {
    const offenders = moduleFiles.filter(path => /from '@ever-co\/connect-sdk'/.test(read(path)) && !path.startsWith('ever-connect/'));
    expect(offenders).toEqual([]);
    const clients = moduleFiles.filter(path => /createEverPlatformClient\(/.test(read(path)));
    expect(clients).toEqual(['ever-connect/ever-connect-platform.client.ts']);
  });

  it('is imported only by app.module.ts and its own folders', () => {
    const offenders = all
      .filter(path => !inModule(path) && !isSpec(path) && path !== 'app.module.ts')
      .filter(
        path => /from '\.{1,2}\/(.*\/)?ever-(instance|stats|connect)\//.test(read(path)) || /from '\.\/ever-platform\/modules'/.test(read(path)),
      );
    expect(offenders).toEqual([]);
  });

  it('names the Ever Platform address only in the configuration', () => {
    const offenders = all.filter(path => !isSpec(path) && /api\.ever\.co/.test(read(path)) && path !== 'ever-platform/env.ts');
    expect(offenders).toEqual([]);
  });

  it('never logs or returns the private key', () => {
    const controller = read('ever-stats/ever-stats.controller.ts');
    expect(controller).not.toMatch(/statsPrivateKeyEnc|privateKeyDer/);
    const logLines = moduleFiles
      .map(read)
      .join('\n')
      .split('\n')
      .filter(line => /logger\.(log|warn|error|debug)|console\.(log|warn|error)/.test(line));
    // A log line may name TR_SECRET, never interpolate a key or the secret
    expect(logLines.filter(line => /\$\{[^}]*(privatekey|secret|keyenc)[^}]*\}/i.test(line))).toEqual([]);
  });
});
