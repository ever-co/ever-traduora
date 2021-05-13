// Adapted from https://github.com/wbhob/nest-middlewares/tree/master/packages/morgan 
// MIT License
// Copyright (c) 2017 Wilson Hobbs

import { Injectable, NestMiddleware } from '@nestjs/common';
import * as morgan from 'morgan';
import http from 'http';

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