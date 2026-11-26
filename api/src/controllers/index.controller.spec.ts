import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config';
import { NotFoundException } from '@nestjs/common';
import { parseEverAppLinks } from '../utils/ever-app-links';
import IndexController, { DEMO_META_TAG, everAppLinksMetaTag, isApiPath, redirectTaggedIndexFile, withDemoMarker } from './index.controller';

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

describe('redirectTaggedIndexFile', () => {
  const originalDemo = config.demo;

  const run = (method: string, path: string) => {
    let redirectedTo: string | undefined;
    let passed = false;
    redirectTaggedIndexFile(
      { method, path },
      {
        redirect: (url: string) => {
          redirectedTo = url;
        },
      },
      () => {
        passed = true;
      },
    );
    return { redirectedTo, passed };
  };

  afterEach(() => {
    config.demo = originalDemo;
  });

  it('sends a direct /index.html request to / on a demo install, where the tagged page is served', () => {
    config.demo = true;

    expect(run('GET', '/index.html')).toEqual({ redirectedTo: '/', passed: false });
    expect(run('HEAD', '/index.html')).toEqual({ redirectedTo: '/', passed: false });
    // Percent-encoded, as the static handler decodes it
    expect(run('GET', '/%69ndex.html')).toEqual({ redirectedTo: '/', passed: false });
  });

  it('passes every other request on a demo install', () => {
    config.demo = true;

    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/projects'],
      ['GET', '/main.js'],
      ['GET', '/api/v1/auth/providers'],
      ['POST', '/index.html'],
      ['GET', '/%E0%A4%A'],
    ]) {
      expect([method, path, run(method, path)]).toEqual([method, path, { redirectedTo: undefined, passed: true }]);
    }
  });

  it('passes /index.html untouched on any other install', () => {
    config.demo = false;

    expect(run('GET', '/index.html')).toEqual({ redirectedTo: undefined, passed: true });
  });
});

describe('IndexController Ever app links', () => {
  const originalDemo = config.demo;
  const originalLinks = config.everAppLinks;
  const originalPublicDir = config.publicDir;
  const LINKS = 'platform=https://app-dev.ever.example,works=https://app-dev.works.example/';
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tr-index-links-'));
    writeFileSync(join(dir, 'index.html'), INDEX_HTML);
    config.publicDir = dir;
    config.demo = false;
  });

  afterEach(() => {
    config.demo = originalDemo;
    config.everAppLinks = originalLinks;
    config.publicDir = originalPublicDir;
    rmSync(dir, { recursive: true, force: true });
  });

  it('is off unless EVER_APP_LINKS is set', () => {
    expect(originalLinks.size).toBe(0);
    expect(everAppLinksMetaTag(originalLinks)).toBe('');
  });

  it('adds the normalized links as a tag to index.html', async () => {
    config.everAppLinks = parseEverAppLinks(LINKS);
    const { res, sent } = fakeResponse();

    await new IndexController().index(res);

    const tag = '<meta name="ever-app-links" content="platform=https://app-dev.ever.example/,works=https://app-dev.works.example/">';
    expect(sent.file).toBeUndefined();
    expect(sent.headers['Cache-Control']).toBe('no-cache');
    expect(sent.body).toBe(INDEX_HTML.replace('<head>', `<head>${tag}`));
  });

  it('adds both tags on a demo install with links', async () => {
    config.demo = true;
    config.everAppLinks = parseEverAppLinks(LINKS);
    const { res, sent } = fakeResponse();

    await new IndexController().index(res);

    expect(sent.body).toContain(`<head>${DEMO_META_TAG}<meta name="ever-app-links"`);
  });

  it('escapes what could break out of the attribute', () => {
    const tag = everAppLinksMetaTag(parseEverAppLinks('platform=https://app.example/apps?a=1&b="x"<y>'));

    expect(tag).toBe('<meta name="ever-app-links" content="platform=https://app.example/apps?a=1&amp;b=%22x%22%3Cy%3E">');
    expect(tag.match(/"/g)).toHaveLength(4);
  });

  it('sends a direct /index.html request to the tagged page when links are set', () => {
    config.everAppLinks = parseEverAppLinks(LINKS);
    let redirectedTo: string | undefined;
    let passed = false;

    redirectTaggedIndexFile(
      { method: 'GET', path: '/index.html' },
      {
        redirect: (url: string) => {
          redirectedTo = url;
        },
      },
      () => {
        passed = true;
      },
    );

    expect({ redirectedTo, passed }).toEqual({ redirectedTo: '/', passed: false });
  });
});

describe('IndexController under /api', () => {
  it('answers 404 for a path under /api that no route answers, never the web app page', async () => {
    const { res, sent } = fakeResponse();
    await expect(new IndexController().index(res, { path: '/api/v1/ever-stats/status' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(new IndexController().index(res, { path: '/api' })).rejects.toBeInstanceOf(NotFoundException);
    expect(sent.file).toBeUndefined();
    expect(sent.body).toBeUndefined();
  });

  it('tells API paths from pages of the web app', () => {
    expect(isApiPath('/api/v1/projects')).toBe(true);
    expect(isApiPath('/API/v1/projects')).toBe(true);
    expect(isApiPath('/api')).toBe(true);
    expect(isApiPath('/apidocs')).toBe(false);
    expect(isApiPath('/projects/api')).toBe(false);
    expect(isApiPath('/ever-platform')).toBe(false);
    expect(isApiPath(undefined)).toBe(false);
  });
});
