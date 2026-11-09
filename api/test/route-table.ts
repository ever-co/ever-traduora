import { INestApplication } from '@nestjs/common';

/**
 * Every route (method and path) the running application answers, read from its Express router, sorted and without
 * duplicates.
 */
export function routeTable(app: INestApplication): string[] {
  const express = app.getHttpAdapter().getInstance();
  const stack: any[] = (express.router ?? express._router)?.stack ?? [];
  const routes = new Set<string>();
  for (const layer of stack) {
    const route = layer?.route;
    if (!route?.path) {
      continue;
    }
    for (const [method, enabled] of Object.entries(route.methods ?? {})) {
      if (enabled && method !== '_all') {
        routes.add(`${method.toUpperCase()} ${route.path}`);
      }
    }
  }
  return [...routes].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}
