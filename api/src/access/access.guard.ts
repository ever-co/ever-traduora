import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ProjectClient } from '../entity/project-client.entity';
import { User } from '../entity/user.entity';
import { AccessUndeclaredException } from '../errors';
import AuthorizationService, { isId } from '../services/authorization.service';
import { ACCESS_METADATA, AccessMetadata, parseAccessRule } from './access.decorator';
import { OPERATOR_CHECK, OperatorCheck } from './operator-check';

/** The JWT sign-in check of `@nestjs/passport`, run here for every route that needs a caller. */
const JwtAuthGuard = AuthGuard('jwt');

/**
 * Default deny for every route (DESIGN §3.4, layer 1). Runs before the route's own guards: a route without `@Access`
 * (or with a rule it does not know) answers 403 `access_undeclared`; otherwise the caller is signed in where the rule
 * needs one (401 when not) and the rule is checked:
 * - `user`: a person, not an API key (401, or 404 where the route always answered that to API keys);
 * - `project:<Action>`: `AuthorizationService.assertProjectAccess` on the route's `:projectId` (the handler then gets the
 *   same answer without a second lookup);
 * - `organization:<Action>`: `AuthorizationService.authorizeOrganizationAction` on the route's `:organizationId`;
 * - `operator`: the installation's operator, else 404, as the Ever Platform pages answer;
 * - `public`, `webhook`: no caller needed (a webhook verifies its call itself).
 * Handlers keep their own checks: this guard is the floor, not a replacement.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  private readonly jwt = new JwtAuthGuard();

  constructor(
    private readonly reflector: Reflector,
    private readonly authorization: AuthorizationService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') {
      return true;
    }
    const metadata = this.reflector.getAllAndOverride<AccessMetadata | undefined>(ACCESS_METADATA, [context.getHandler(), context.getClass()]);
    const rule = parseAccessRule(metadata?.rule);
    if (!rule) {
      throw new AccessUndeclaredException();
    }
    // A switched-off route is not there, for anyone
    metadata.options.enabled?.(this.moduleRef);
    if (rule.kind === 'public' || rule.kind === 'webhook') {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const caller = await this.signedIn(context, request);
    switch (rule.kind) {
      case 'user':
        if (metadata.options.apiKeys !== 'allowed') {
          this.mustBeUser(caller, metadata.options.apiKeys === 'not-found');
        }
        return true;
      case 'project':
        await this.authorization.assertProjectAccess(caller, this.routeId(request, 'projectId', 'project not found'), rule.action);
        return true;
      case 'organization':
        await this.authorization.authorizeOrganizationAction(
          this.mustBeUser(caller, false),
          this.routeId(request, 'organizationId', 'organization not found'),
          rule.action,
        );
        return true;
      case 'operator':
        if (!this.isOperator(caller)) {
          throw new NotFoundException();
        }
        return true;
      default:
        throw new AccessUndeclaredException();
    }
  }

  /** The caller of the request: the one a guard before signed in, else the JWT's (401 without a valid one). */
  private async signedIn(context: ExecutionContext, request: { user?: User | ProjectClient }): Promise<User | ProjectClient> {
    if (!request.user) {
      await this.jwt.canActivate(context);
    }
    if (!request.user) {
      throw new UnauthorizedException();
    }
    return request.user;
  }

  /** The route's id parameter, refused (403) unless it is a non-empty string. */
  private routeId(request: { params?: Record<string, unknown> }, name: string, notFound: string): string {
    const value = request.params?.[name];
    if (!isId(value)) {
      throw new ForbiddenException(notFound);
    }
    return value;
  }

  private mustBeUser(caller: User | ProjectClient, apiKeyNotFound: boolean): User {
    if (caller instanceof User) {
      return caller;
    }
    if (apiKeyNotFound) {
      throw new NotFoundException();
    }
    throw new UnauthorizedException('only users are allowed to perform this action');
  }

  /** The operator check of the Ever Platform pages; without their module loaded, there is no operator route to open. */
  private isOperator(caller: User | ProjectClient): boolean {
    let check: OperatorCheck | undefined;
    try {
      check = this.moduleRef.get<OperatorCheck>(OPERATOR_CHECK, { strict: false });
    } catch {
      check = undefined;
    }
    return !!check && check.isOperator(caller);
  }
}
