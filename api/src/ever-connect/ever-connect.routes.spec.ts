import { RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { readFileSync } from 'fs';
import { join } from 'path';
import { EverAdminGuard } from '../ever-instance/ever-admin.guard';
import { EverConnectPersonController, EverSignedInUserGuard } from './ever-connect-person.controller';
import { EverConnectController } from './ever-connect.controller';

interface RouteEntry {
  method: string;
  path: string;
  access: 'public' | 'operator' | 'self';
}

const manifest: { routes: RouteEntry[] } = JSON.parse(readFileSync(join(__dirname, 'ever-connect.routes.json'), 'utf8'));

/** The routes the controllers declare, read from their Nest metadata. */
function declaredRoutes(): RouteEntry[] {
  return [...routesOf(EverConnectController), ...routesOf(EverConnectPersonController)];
}

function routesOf(controller: { prototype: object }): RouteEntry[] {
  const base = Reflect.getMetadata(PATH_METADATA, controller) as string;
  const prototype = controller.prototype;
  return Object.getOwnPropertyNames(prototype)
    .filter(name => name !== 'constructor' && Reflect.getMetadata(PATH_METADATA, prototype[name]) !== undefined)
    .map(name => {
      const handler = prototype[name];
      const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, handler) || [];
      const route: RouteEntry = {
        method: RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number],
        path: `/${base}/${Reflect.getMetadata(PATH_METADATA, handler)}`,
        access: guards.includes(EverAdminGuard) ? 'operator' : guards.includes(EverSignedInUserGuard) ? 'self' : 'public',
      };
      return route;
    });
}

describe('ever-connect.routes.json', () => {
  const byPath = (a: RouteEntry, b: RouteEntry) => (a.path + a.method < b.path + b.method ? -1 : 1);

  it('lists every route of the controller, with who may call it', () => {
    expect([...manifest.routes].sort(byPath)).toEqual(declaredRoutes().sort(byPath));
  });

  it('leaves only the health check public', () => {
    expect(manifest.routes.filter(route => route.access === 'public').map(route => route.path)).toEqual(['/api/v1/ever-connect/health']);
  });
});
