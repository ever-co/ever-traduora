import { Controller, Get, NotFoundException, Req, Res } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'path';
import { config } from '../config';
import { ApiExcludeEndpoint } from '@nestjs/swagger';

/**
 * The tag a demo install (`TR_DEMO=true`) adds to the web app's index.html. The web app shows its demo banner
 * only when the page carries it, so every other install serves index.html exactly as built.
 */
export const DEMO_META_TAG = '<meta name="traduora-demo" content="true">';

/** index.html with the demo tag first in its <head>; unchanged when it has no <head>. */
export const withDemoMarker = (html: string): string => html.replace(/<head(\s[^>]*)?>/i, head => `${head}${DEMO_META_TAG}`);

/** The path percent-decoded; undefined when it is malformed (the static handler then answers 400 itself). */
const decodedPath = (path: string): string | undefined => {
  try {
    return decodeURIComponent(path);
  } catch {
    return undefined;
  }
};

/**
 * Express middleware, mounted before the static files: on a demo install a direct request for /index.html would be
 * answered by the static handler with the file as built (no demo tag), so it is sent to / instead, which the
 * IndexController answers with the tagged page. The path is compared decoded, as the static handler decodes it
 * (`/%69ndex.html` is the same file). Every other request, and every request on other installs, passes on.
 */
export const redirectDemoIndexFile = (req: { method: string; path: string }, res: { redirect: (url: string) => void }, next: () => void): void => {
  if (config.demo && (req.method === 'GET' || req.method === 'HEAD') && decodedPath(req.path) === '/index.html') {
    res.redirect('/');
    return;
  }
  next();
};

/** Whether a path is under the API (`/api` or `/api/...`): never a page of the web app. */
export const isApiPath = (path: unknown): boolean => typeof path === 'string' && /^\/api(\/|$)/i.test(path);

@Controller()
export default class IndexController {
  /**
   * The web app's page for every other GET, so that its own routes load on a refresh. A path under `/api` that no route
   * answers is a 404, as for any other method: a client asking for an API route that does not exist (or a module that is
   * not loaded) never gets the web app's page instead.
   */
  @Get('{*splat}')
  @ApiExcludeEndpoint()
  async index(@Res() res, @Req() req?) {
    if (req && isApiPath(req.path)) {
      throw new NotFoundException();
    }
    const file = resolve(config.publicDir, 'index.html');
    if (config.demo) {
      const html = await readFile(file, 'utf8').catch(() => undefined);
      if (html !== undefined) {
        res.type('html').set('Cache-Control', 'no-cache').send(withDemoMarker(html));
        return;
      }
    }
    res.sendFile(file);
  }
}
