import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EverAdminGuard } from '../ever-instance/ever-admin.guard';
import { EverStatsController } from './ever-stats.controller';

interface RouteEntry {
  method: string;
  path: string;
  access: 'public' | 'operator';
}

const manifest: { routes: RouteEntry[] } = JSON.parse(readFileSync(join(__dirname, 'ever-stats.routes.json'), 'utf8'));

/** The routes the controller declares, read from its Nest metadata. */
function declaredRoutes(): RouteEntry[] {
  const base = Reflect.getMetadata(PATH_METADATA, EverStatsController) as string;
  const prototype = EverStatsController.prototype;
  return Object.getOwnPropertyNames(prototype)
    .filter(name => name !== 'constructor' && Reflect.getMetadata(PATH_METADATA, prototype[name]) !== undefined)
    .map(name => {
      const handler = prototype[name];
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) || [];
      const route: RouteEntry = {
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number],
        path: `/${base}/${Reflect.getMetadata(PATH_METADATA, handler)}`,
        access: guards.includes(EverAdminGuard) ? 'operator' : 'public',
      };
      return route;
    });
}

describe('ever-stats.routes.json', () => {
  const byPath = (a: RouteEntry, b: RouteEntry) => (a.path + a.method < b.path + b.method ? -1 : 1);

  it('lists every route of the controller, with who may call it', () => {
    expect([...manifest.routes].sort(byPath)).toEqual(declaredRoutes().sort(byPath));
  });

  it('leaves only the health check public', () => {
    expect(manifest.routes.filter(route => route.access === 'public').map(route => route.path)).toEqual(['/api/v1/ever-stats/health']);
  });
});
