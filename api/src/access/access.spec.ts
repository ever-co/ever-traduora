import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppModule } from '../app.module';
import { ProjectAction } from '../domain/actions';
import { OrganizationAction } from '../domain/organization-actions';
import { ProjectClient } from '../entity/project-client.entity';
import { User } from '../entity/user.entity';
import { AccessUndeclaredException } from '../errors';
import { EverConnectModule } from '../ever-connect/ever-connect.module';
import { EverInstanceModule } from '../ever-instance/ever-instance.module';
import { EverStatsModule } from '../ever-stats/ever-stats.module';
import { Access, ACCESS_METADATA, parseAccessRule } from './access.decorator';
import { AccessGuard } from './access.guard';
import { controllersOf, routesOf } from './routes';
import { config } from '../config';
import { currentLegalDocuments } from '../accounts/legal-documents';

/** Every route of the app, the optional Ever Platform modules included (they are loaded by configuration). */
const routes = routesOf(controllersOf([AppModule, EverInstanceModule, EverStatsModule, EverConnectModule]));
const label = route => `${route.method} ${route.path} (${route.controller.name}.${route.handlerName})`;

describe('every route declares who may call it', () => {
  it('finds the routes of every controller', () => {
    expect(routes.length).toBeGreaterThan(90);
    expect(new Set(routes.map(route => route.controller.name))).toContain('EverConnectController');
  });

  it('has an @Access rule the guard knows, on every route', () => {
    const missing = routes.filter(route => !parseAccessRule(route.access?.rule)).map(label);
    expect(missing).toEqual([]);
  });

  it('names the project or the organization a project or organization rule checks', () => {
    const wrong = routes
      .filter(route => {
        const rule = parseAccessRule(route.access?.rule);
        return (
          (rule?.kind === 'project' && !route.path.includes(':projectId')) ||
          (rule?.kind === 'organization' && !route.path.includes(':organizationId'))
        );
      })
      .map(label);
    expect(wrong).toEqual([]);
  });

  it('puts every /projects/:projectId route behind a project rule, every /organizations/:organizationId one behind an organization rule', () => {
    const loose = routes
      .filter(
        route =>
          (route.path.includes('/projects/:projectId') && !route.access?.rule.startsWith('project:')) ||
          (route.path.includes('/organizations/:organizationId') && !route.access?.rule.startsWith('organization:')),
      )
      .map(label);
    expect(loose).toEqual([]);
  });

  it('keeps the routes anyone may call to this reviewed list', () => {
    // Adding a public or webhook route is a decision: it changes this list on purpose
    const open = routes
      .filter(route => ['public', 'webhook'].includes(route.access?.rule))
      .map(route => `${route.access.rule} ${route.method} ${route.path}`)
      .sort((a, b) => a.localeCompare(b));
    expect(open).toEqual(
      [
        'public GET /health',
        'public GET /{*splat}',
        'public GET /api/v1/auth/providers',
        'public POST /api/v1/auth/signup',
        'public POST /api/v1/auth/signup-provider',
        'public POST /api/v1/auth/token',
        'public POST /api/v1/auth/forgot-password',
        'public POST /api/v1/auth/reset-password',
        'public POST /api/v1/auth/everid/signup-confirm',
        'webhook POST /api/v1/auth/everid/backchannel-logout',
        'public GET /api/v1/ever-connect/health',
        'public GET /api/v1/ever-stats/health',
        'public POST /api/v1/ever-connect/provision/intent',
        'public POST /api/v1/ever-connect/provision/intents/:jti/reject',
      ].sort((a, b) => a.localeCompare(b)),
    );
  });

  it('keeps the routes a pending account may call to this reviewed list', () => {
    // An account whose e-mail is not confirmed, or whose terms are not accepted, reaches only these (DESIGN §3.8)
    const pending = routes
      .filter(route => route.access?.options.whilePending)
      .map(route => `${route.access.rule} ${route.method} ${route.path}`)
      .sort((a, b) => a.localeCompare(b));
    expect(pending).toEqual(
      [
        'user DELETE /api/v1/auth/identities/:id',
        'user DELETE /api/v1/users/me',
        'user GET /api/v1/auth/identities',
        'user GET /api/v1/users/me',
        'user PATCH /api/v1/users/me',
        'user POST /api/v1/auth/accept-terms',
        'user POST /api/v1/auth/change-password',
        'user POST /api/v1/auth/identities/connect',
        'user POST /api/v1/auth/identities/connect/confirm',
        'user POST /api/v1/auth/resend-verification-email',
        'user POST /api/v1/auth/verify-email',
      ].sort((a, b) => a.localeCompare(b)),
    );
  });
});

describe('parseAccessRule', () => {
  it('reads every kind, and refuses anything else', () => {
    expect(parseAccessRule('public')).toEqual({ kind: 'public' });
    expect(parseAccessRule('project:ViewTerm')).toEqual({ kind: 'project', action: ProjectAction.ViewTerm });
    expect(parseAccessRule('organization:EditMembers')).toEqual({ kind: 'organization', action: OrganizationAction.EditMembers });
    for (const rule of [undefined, '', 'admin', 'project:', 'project:Nope', 'project:0', 'organization:ViewTerm', 'public:x']) {
      expect([rule, parseAccessRule(rule)]).toEqual([rule, undefined]);
    }
  });
});

describe('AccessGuard', () => {
  const user = Object.assign(new User(), { id: 'u1', email: 'u@test.com', emailVerified: true });
  const client = Object.assign(new ProjectClient(), { id: 'c1' });

  /** A request to a handler with `metadata`, from `caller`, with these route parameters. */
  const context = (metadata: unknown, caller?: unknown, params: Record<string, string> = {}): ExecutionContext => {
    const handler = () => undefined;
    if (metadata) {
      Reflect.defineMetadata(ACCESS_METADATA, metadata, handler);
    }
    const request = { user: caller, params };
    return {
      getType: () => 'http',
      getHandler: () => handler,
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
    } as unknown as ExecutionContext;
  };
  const access = (rule: Parameters<typeof Access>[0], options = {}) => ({ rule, options });

  const make = (overrides: { operator?: boolean } = {}) => {
    const authorization = {
      assertProjectAccess: jest.fn().mockResolvedValue({}),
      authorizeOrganizationAction: jest.fn().mockResolvedValue({}),
    };
    const moduleRef = {
      get: jest.fn(() => {
        if (overrides.operator === undefined) {
          throw new Error('not loaded');
        }
        return { isOperator: () => overrides.operator };
      }),
    };
    return { guard: new AccessGuard(new Reflector(), authorization as any, moduleRef as any), authorization };
  };

  it('answers 403 to a route without a rule', async () => {
    await expect(make().guard.canActivate(context(undefined, user))).rejects.toBeInstanceOf(AccessUndeclaredException);
    await expect(make().guard.canActivate(context(access('nope' as any), user))).rejects.toBeInstanceOf(AccessUndeclaredException);
  });

  it('opens public and webhook routes to anyone', async () => {
    await expect(make().guard.canActivate(context(access('public')))).resolves.toBe(true);
    await expect(make().guard.canActivate(context(access('webhook')))).resolves.toBe(true);
  });

  it('keeps user routes to people: API keys get 401, or 404 where the route said so, or pass where allowed', async () => {
    await expect(make().guard.canActivate(context(access('user'), user))).resolves.toBe(true);
    await expect(make().guard.canActivate(context(access('user'), client))).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(make().guard.canActivate(context(access('user', { apiKeys: 'not-found' }), client))).rejects.toBeInstanceOf(NotFoundException);
    await expect(make().guard.canActivate(context(access('user', { apiKeys: 'allowed' }), client))).resolves.toBe(true);
  });

  it("checks a project rule against the route's project, for people and API keys", async () => {
    const { guard, authorization } = make();
    await guard.canActivate(context(access('project:EditTerm'), client, { projectId: 'p1' }));
    expect(authorization.assertProjectAccess).toHaveBeenCalledWith(client, 'p1', ProjectAction.EditTerm);
    authorization.assertProjectAccess.mockRejectedValueOnce(new NotFoundException());
    await expect(guard.canActivate(context(access('project:EditTerm'), user, { projectId: 'p2' }))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses a project or organization rule without its id, before any lookup', async () => {
    const { guard, authorization } = make();
    for (const params of [{}, { projectId: '' }, { projectId: ['p1'] }] as any[]) {
      await expect(guard.canActivate(context(access('project:ViewProject'), user, params))).rejects.toBeInstanceOf(ForbiddenException);
    }
    for (const params of [{}, { organizationId: '' }] as any[]) {
      await expect(guard.canActivate(context(access('organization:ViewOrganization'), user, params))).rejects.toBeInstanceOf(ForbiddenException);
    }
    expect(authorization.assertProjectAccess).not.toHaveBeenCalled();
    expect(authorization.authorizeOrganizationAction).not.toHaveBeenCalled();
  });

  it("checks an organization rule against the route's organization, for people only", async () => {
    const { guard, authorization } = make();
    await guard.canActivate(context(access('organization:EditMembers'), user, { organizationId: 'o1' }));
    expect(authorization.authorizeOrganizationAction).toHaveBeenCalledWith(user, 'o1', OrganizationAction.EditMembers);
    await expect(guard.canActivate(context(access('organization:ViewOrganization'), client, { organizationId: 'o1' }))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  describe('a pending account (DESIGN §3.8)', () => {
    const saved = { saas: config.saasEnabled, requireVerifiedEmail: config.accounts.requireVerifiedEmail };
    const documents = () => currentLegalDocuments();
    const person = (changes: Partial<User>) =>
      Object.assign(new User(), {
        id: 'u2',
        email: 'p@test.com',
        emailVerified: true,
        termsVersion: documents().terms.version,
        privacyVersion: documents().privacy.version,
        ...changes,
      });
    const codeOf = async (promise: Promise<unknown>) => {
      try {
        await promise;
        return 'passed';
      } catch (error) {
        return `${error.getStatus()} ${error.code ?? ''}`.trim();
      }
    };

    beforeEach(() => {
      config.saasEnabled = true;
      config.accounts.requireVerifiedEmail = undefined;
    });
    afterEach(() => {
      config.saasEnabled = saved.saas;
      config.accounts.requireVerifiedEmail = saved.requireVerifiedEmail;
    });

    it('answers 403 email_not_verified, then terms_not_accepted, on every rule that signs in, before the rule is checked', async () => {
      const { guard, authorization } = make({ operator: true });
      for (const [rule, params] of [
        ['user', {}],
        ['project:ViewTerm', { projectId: 'p1' }],
        ['organization:ViewOrganization', { organizationId: 'o1' }],
        ['operator', {}],
      ] as Array<[Parameters<typeof Access>[0], Record<string, string>]>) {
        expect(await codeOf(guard.canActivate(context(access(rule), person({ emailVerified: false }), params)))).toBe('403 email_not_verified');
        expect(await codeOf(guard.canActivate(context(access(rule), person({ termsVersion: '0.0.1' }), params)))).toBe('403 terms_not_accepted');
        expect(await codeOf(guard.canActivate(context(access(rule), person({}), params)))).toBe('passed');
      }
      expect(authorization.assertProjectAccess).toHaveBeenCalledTimes(1);
      expect(authorization.authorizeOrganizationAction).toHaveBeenCalledTimes(1);
    });

    it('lets a pending account through the routes that declare whilePending, and never asks an API key', async () => {
      const { guard } = make();
      expect(await codeOf(guard.canActivate(context(access('user', { whilePending: true }), person({ emailVerified: false }))))).toBe('passed');
      expect(await codeOf(guard.canActivate(context(access('user', { apiKeys: 'allowed' }), client)))).toBe('passed');
    });

    it('asks nothing of a single-tenant install', async () => {
      config.saasEnabled = false;
      const { guard } = make();
      expect(await codeOf(guard.canActivate(context(access('user'), person({ emailVerified: false, termsVersion: null }))))).toBe('passed');
    });
  });

  it('keeps operator routes to the operator, and to nobody without the Ever Platform modules', async () => {
    await expect(make({ operator: true }).guard.canActivate(context(access('operator'), user))).resolves.toBe(true);
    await expect(make({ operator: false }).guard.canActivate(context(access('operator'), user))).rejects.toBeInstanceOf(NotFoundException);
    await expect(make().guard.canActivate(context(access('operator'), user))).rejects.toBeInstanceOf(NotFoundException);
  });
});
