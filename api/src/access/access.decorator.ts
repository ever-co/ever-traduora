import { SetMetadata } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { ProjectAction } from '../domain/actions';
import { OrganizationAction } from '../domain/organization-actions';

/**
 * Who may call a route (DESIGN §3.4, layer 1). Every controller route declares exactly one rule with `@Access(...)`;
 * the global `AccessGuard` answers 403 to a route without one, so a new route is closed until someone decides.
 *
 * - `public`: anyone, signed in or not.
 * - `user`: a signed-in person (an API key only where the route says `apiKeys: 'allowed'`); no organization is involved.
 * - `project:<ProjectAction>`: a person or an API key allowed that action on the route's `:projectId`
 *   (`AuthorizationService.authorizeProjectAction`, which checks the project's organization first).
 * - `organization:<OrganizationAction>`: a person whose role in the route's `:organizationId` allows that action.
 * - `operator`: the operator of the installation (`TR_EVER_ADMIN_EMAILS`, a verified e-mail).
 * - `webhook`: a call from another service, which the handler verifies itself (a signature, a logout token).
 */
export type ProjectActionName = keyof typeof ProjectAction;

export type AccessRule = 'public' | 'user' | 'operator' | 'webhook' | `project:${ProjectActionName}` | `organization:${OrganizationAction}`;

export interface AccessOptions {
  /**
   * `user` routes and API keys: refused with 401 by default; `not-found` where the route always answered them 404;
   * `allowed` for reference data every signed-in caller reads (the locales).
   */
  apiKeys?: 'unauthorized' | 'not-found' | 'allowed';
  /**
   * Whether the route exists at all, decided before anything else: a switched-off module answers 404 to everyone, signed
   * in or not, as if the route were not there. Throws to refuse; given the module reference to find its settings.
   */
  enabled?: (moduleRef: ModuleRef) => void;
  /**
   * Whether the route works for a person whose account is still pending (DESIGN §3.8): an e-mail not confirmed yet
   * (TR_REQUIRE_VERIFIED_EMAIL) or, in SaaS mode, terms not accepted yet. Every other route answers them 403
   * `email_not_verified` / `terms_not_accepted`. Only the sign-in and account routes, `users/me`, verify, resend and the
   * acceptance itself declare it; `access.spec.ts` keeps that list.
   */
  whilePending?: true;
}

export interface AccessMetadata {
  rule: AccessRule;
  options: AccessOptions;
}

export const ACCESS_METADATA = 'traduora:access';

export function Access(rule: AccessRule, options: AccessOptions = {}) {
  return SetMetadata<string, AccessMetadata>(ACCESS_METADATA, { rule, options });
}

export type ParsedAccessRule =
  | { kind: 'public' | 'user' | 'operator' | 'webhook' }
  | { kind: 'project'; action: ProjectAction }
  | { kind: 'organization'; action: OrganizationAction };

/** The rule as the guard reads it; `undefined` for a rule it does not know (which the guard refuses). */
export function parseAccessRule(rule: string | undefined): ParsedAccessRule | undefined {
  switch (rule) {
    case 'public':
    case 'user':
    case 'operator':
    case 'webhook':
      return { kind: rule };
  }
  const [kind, name] = (rule ?? '').split(':');
  if (kind === 'project' && name && Object.prototype.hasOwnProperty.call(ProjectAction, name) && Number.isNaN(Number(name))) {
    return { kind, action: ProjectAction[name as ProjectActionName] };
  }
  if (kind === 'organization' && (Object.values(OrganizationAction) as string[]).includes(name)) {
    return { kind, action: name as OrganizationAction };
  }
  return undefined;
}
