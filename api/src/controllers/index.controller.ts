import { Controller, Get, Res } from '@nestjs/common';
import { readFile } from 'fs/promises';
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

@Controller()
export default class IndexController {
  @Get('{*splat}')
  @ApiExcludeEndpoint()
  async index(@Res() res) {
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
