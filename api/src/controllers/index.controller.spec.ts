import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { config } from '../config';
import IndexController, { DEMO_META_TAG, withDemoMarker } from './index.controller';

const INDEX_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Traduora</title></head><body><app-root></app-root></body></html>';

/** A stand-in for the Express response, recording what the controller answered. */
const fakeResponse = () => {
  const sent: { file?: string; body?: string; type?: string; headers: Record<string, string> } = { headers: {} };
  const res = {
    sendFile: (file: string) => {
      sent.file = file;
    },
    type: (type: string) => {
      sent.type = type;
      return res;
    },
    set: (name: string, value: string) => {
      sent.headers[name] = value;
      return res;
    },
    send: (body: string) => {
      sent.body = body;
    },
  };
  return { res, sent };
};

describe('IndexController demo marker', () => {
  const originalDemo = config.demo;
  const originalPublicDir = config.publicDir;
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tr-index-'));
    writeFileSync(join(dir, 'index.html'), INDEX_HTML);
    config.publicDir = dir;
  });

  afterEach(() => {
    config.demo = originalDemo;
    config.publicDir = originalPublicDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('is off unless TR_DEMO is set', () => {
    expect(originalDemo).toBe(false);
  });

  it('serves index.html untouched when the install is not a demo', async () => {
    config.demo = false;
    const { res, sent } = fakeResponse();

    await new IndexController().index(res);

    expect(sent.file).toBe(join(dir, 'index.html'));
    expect(sent.body).toBeUndefined();
  });

  it('adds the demo tag to index.html on a demo install', async () => {
    config.demo = true;
    const { res, sent } = fakeResponse();

    await new IndexController().index(res);

    expect(sent.file).toBeUndefined();
    expect(sent.type).toBe('html');
    expect(sent.headers['Cache-Control']).toBe('no-cache');
    expect(sent.body).toBe(INDEX_HTML.replace('<head>', `<head>${DEMO_META_TAG}`));
  });

  it('falls back to the plain file when index.html cannot be read', async () => {
    config.demo = true;
    rmSync(join(dir, 'index.html'));
    const { res, sent } = fakeResponse();

    await new IndexController().index(res);

    expect(sent.file).toBe(join(dir, 'index.html'));
    expect(sent.body).toBeUndefined();
  });

  it('keeps the attributes of <head> and leaves a page without one unchanged', () => {
    expect(withDemoMarker('<html><head data-x="1"><title>t</title></head></html>')).toBe(
      `<html><head data-x="1">${DEMO_META_TAG}<title>t</title></head></html>`,
    );
    expect(withDemoMarker('<html><header></header></html>')).toBe('<html><header></header></html>');
  });
});
