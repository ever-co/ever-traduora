import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Connection } from 'typeorm';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { config } from '../src/config';
import { DEMO_META_TAG } from '../src/controllers/index.controller';
import { createAndMigrateApp } from './util';

const INDEX_HTML = '<!doctype html><html><head><title>Traduora</title></head><body><app-root></app-root></body></html>';

describe('Demo install index.html (e2e)', () => {
  let app: INestApplication;
  let dir: string;
  const originalDemo = config.demo;
  const originalPublicDir = config.publicDir;

  beforeAll(async () => {
    // The static handler is mounted with config.publicDir at boot, so the folder is set before the app is created
    dir = mkdtempSync(join(tmpdir(), 'tr-demo-index-'));
    writeFileSync(join(dir, 'index.html'), INDEX_HTML);
    config.publicDir = dir;
    app = await createAndMigrateApp();
  });

  afterEach(() => {
    config.demo = originalDemo;
  });

  it('serves the page with the demo tag on a demo install', async () => {
    config.demo = true;

    const res = await request(app.getHttpServer()).get('/projects').expect(200);

    expect(res.text).toContain(DEMO_META_TAG);
    expect(res.header['cache-control']).toEqual('no-cache');
  });

  it('sends a direct /index.html request to the tagged page on a demo install', async () => {
    config.demo = true;

    await request(app.getHttpServer()).get('/index.html').expect(302).expect('Location', '/');
    await request(app.getHttpServer()).get('/%69ndex.html').expect(302).expect('Location', '/');
  });

  it('serves index.html as built on any other install', async () => {
    config.demo = false;

    const page = await request(app.getHttpServer()).get('/projects').expect(200);
    expect(page.text).toEqual(INDEX_HTML);

    const file = await request(app.getHttpServer()).get('/index.html').expect(200);
    expect(file.text).toEqual(INDEX_HTML);
  });

  afterAll(async () => {
    config.publicDir = originalPublicDir;
    rmSync(dir, { recursive: true, force: true });
    await app.get(Connection).close();
    await app.close();
  });
});
