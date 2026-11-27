import { RequestMethod, Type } from '@nestjs/common';
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { MetadataScanner } from '@nestjs/core';
import { ACCESS_METADATA, AccessMetadata } from './access.decorator';

/** One route of a controller, with the access rule it declares (if any). */
export interface RouteInfo {
  controller: Type<unknown>;
  handlerName: string;
  method: string;
  /** The full path, with its parameters, e.g. `/api/v1/projects/:projectId/terms/:termId`. */
  path: string;
  access: AccessMetadata | undefined;
}

type ModuleLike = Type<unknown> | { module?: Type<unknown>; controllers?: Type<unknown>[]; imports?: unknown[] } | undefined;

/** Every controller of these modules and of the modules they import, read from their metadata (nothing is started). */
export function controllersOf(roots: ModuleLike[]): Type<unknown>[] {
  const seen = new Set<unknown>();
  const controllers = new Set<Type<unknown>>();
  const visit = (entry: ModuleLike) => {
    if (!entry || seen.has(entry)) {
      return;
    }
    seen.add(entry);
    const dynamic = typeof entry === 'function' ? undefined : entry;
    const moduleClass = typeof entry === 'function' ? entry : entry.module;
    const declared: Type<unknown>[] = [
      ...((moduleClass && Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, moduleClass)) ?? []),
      ...(dynamic?.controllers ?? []),
    ];
    declared.forEach(controller => controllers.add(controller));
    const imports: ModuleLike[] = [
      ...((moduleClass && Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass)) ?? []),
      ...((dynamic?.imports as ModuleLike[]) ?? []),
    ];
    imports.forEach(visit);
  };
  roots.forEach(visit);
  return [...controllers];
}

const joinPath = (...parts: Array<string | undefined>) =>
  '/' +
  parts
    .filter(part => part !== undefined && part !== '' && part !== '/')
    .map(part => String(part).replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(Boolean)
    .join('/');

/** The routes of these controllers. */
export function routesOf(controllers: Type<unknown>[]): RouteInfo[] {
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];
  for (const controller of controllers) {
    const prefixes = [].concat(Reflect.getMetadata(PATH_METADATA, controller) ?? '');
    const classAccess: AccessMetadata | undefined = Reflect.getMetadata(ACCESS_METADATA, controller);
    for (const handlerName of scanner.getAllMethodNames(controller.prototype)) {
      const handler = controller.prototype[handlerName];
      const paths = Reflect.getMetadata(PATH_METADATA, handler);
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (paths === undefined || method === undefined) {
        continue;
      }
      const access: AccessMetadata | undefined = Reflect.getMetadata(ACCESS_METADATA, handler) ?? classAccess;
      for (const prefix of prefixes) {
        for (const path of [].concat(paths)) {
          routes.push({ controller, handlerName, method: RequestMethod[method], path: joinPath(prefix, path), access });
        }
      }
    }
  }
  return routes;
}
