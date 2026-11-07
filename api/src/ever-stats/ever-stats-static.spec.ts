import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { readEverPlatformConfig, resolveSecret } from '../config';

const SRC = join(__dirname, '..');
const MODULE_DIRS = ['ever-stats', 'ever-instance'];

/** The source files (no spec) under `dir`, relative to `api/src`, with `/` separators. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (name.endsWith('.ts') && !name.endsWith('.spec.ts')) out.push(relative(SRC, path).split('\\').join('/'));
  }
  return out;
}

const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
const moduleSources = MODULE_DIRS.flatMap(dir => sources(join(SRC, dir)));

/** `file:line` of every line of `files` matching `pattern`. */
function findings(files: string[], pattern: RegExp): string[] {
  return files.flatMap(file =>
    read(file)
      .split('\n')
      .map((line, i) => (pattern.test(line) ? `${file}:${i + 1}` : null))
      .filter(Boolean),
  );
}

describe('static rules of the Ever Platform modules', () => {
  it('finds the module sources', () => {
    expect(moduleSources).toEqual(expect.arrayContaining(['ever-stats/ever-stats-sender.service.ts', 'ever-instance/ever-instance.service.ts']));
  });

  it('never guess where they run: no environment read of their own, no host name, no database type, no Docker flag', () => {
    // Every setting comes from config.ts; TR_EVER_INSTALL_SOURCE is the only source of install_source
    const inference = /process\.env|TR_VIRTUAL_HOST|virtualHost|IS_DOCKER|TR_DB_TYPE|db\.default\.type|os\.hostname|hostname\(\)/;
    expect(findings(moduleSources, inference)).toEqual([]);
  });

  it('make their one request in the sender only', () => {
    const network = /from '(@nestjs\/axios|axios|http|https|net|tls|dgram|node:http|node:https)'|\bfetch\(|HttpModule|HttpService/;
    const files = findings(moduleSources, network).map(found => found.replace(/:\d+$/, ''));
    expect([...new Set(files)]).toEqual(['ever-stats/ever-stats-sender.service.ts']);
    expect(findings(sources(join(SRC, 'ever-instance')), network)).toEqual([]);
  });

  it('name no Ever host in code: the default address lives in config.ts', () => {
    expect(findings(moduleSources, /ever\.co\b/)).toEqual([]);
  });

  it('are imported only by app.module.ts and by each other', () => {
    const outside = sources(SRC).filter(file => !MODULE_DIRS.some(dir => file.startsWith(`${dir}/`)));
    const importers = findings(outside, /from '\.\.?\/(\.\.\/)*(ever-stats|ever-instance)\//).map(found => found.replace(/:\d+$/, ''));
    expect([...new Set(importers)]).toEqual(['app.module.ts']);
  });

  it('never read a published secret: the API refuses one at startup, and without TR_SECRET nothing is sent', () => {
    expect(() => resolveSecret('secret', 'development')).toThrow(/TR_SECRET/);
    expect(readEverPlatformConfig({}, () => undefined).secretConfigured).toBe(false);
  });
});
