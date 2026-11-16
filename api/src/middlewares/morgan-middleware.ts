// Adapted from https://github.com/wbhob/nest-middlewares/tree/master/packages/morgan
// MIT License
// Copyright (c) 2017 Wilson Hobbs

import { Injectable, NestMiddleware } from '@nestjs/common';
import * as morgan from 'morgan';
import http from 'http';

const REDACTED = 'REDACTED';

/**
 * Keeps the path and every query key of a URL, but replaces each query value with REDACTED.
 * Emailed links carry secrets (reset, invite and verification tokens) and addresses in the query string,
 * which must not reach the access logs. A URL without a query string is returned unchanged.
 * Never throws: non-string input is returned as an empty string.
 */
export function redactUrl(url: string): string {
  if (typeof url !== 'string') {
    return '';
  }
  const queryStart = url.indexOf('?');
  if (queryStart === -1) {
    return url;
  }
  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);
  if (query === '') {
    return url;
  }
  const redacted = query
    .split('&')
    .map(pair => {
      const eq = pair.indexOf('=');
      return eq === -1 ? pair : `${pair.slice(0, eq)}=${REDACTED}`;
    })
    .join('&');
  return `${path}?${redacted}`;
}

morgan.token('safe-url', (req: any) => redactUrl(req.originalUrl || req.url));

/** The 'short' format, with the query string redacted. */
export const SAFE_SHORT_FORMAT =
  ':remote-addr :remote-user :method :safe-url HTTP/:http-version :status :res[content-length] - :response-time ms';

@Injectable()
export class MorganMiddleware implements NestMiddleware {
  public static configure(format: string | morgan.FormatFn, opts?: morgan.Options<http.IncomingMessage, http.ServerResponse>) {
    this.format = format;
    this.options = opts;
  }

  public static token(name: string, callback: morgan.TokenCallbackFn) {
    return morgan.token(name, callback);
  }

  private static options: morgan.Options<http.IncomingMessage, http.ServerResponse>;
  private static format: string | morgan.FormatFn;

  public use(req: any, res: any, next: any) {
    if (MorganMiddleware.format) {
      morgan(MorganMiddleware.format as any, MorganMiddleware.options)(req, res, next);
    } else {
      throw new Error('MorganMiddleware must be configured with a logger format.');
    }
  }
}
