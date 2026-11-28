import { OPERATOR_CHECK } from '../access/operator-check';
import { config } from '../config';
import { User } from '../entity/user.entity';
import { BillingCancellationStatus } from '../entity/organization-billing-cancellation.entity';
import { billingCancellation, NO_BILLING_CANCELLATION, settleBillingCancellations } from '../services/organization/billing-cancellation';
import { exportFileName, localeFile, pathSegment, projectFolder } from '../services/organization/organization-export.service';
import { assertDeletionConfirmed } from '../services/organization/organization-membership';
import { releasedSlug, searchPattern } from '../services/organization/organization-operator.service';
import { explicitOperatorEmails, OperatorCheckService } from './operator-check.service';
import { pageNumber } from './operator.dto';
import OrganizationController from '../controllers/organization.controller';
import { OrganizationDataController } from './organization-data.controller';

const account = (email: string, emailVerified = true) => Object.assign(new User(), { id: 'u1', email, emailVerified });

describe('OperatorCheckService', () => {
  const moduleRef = (checks: unknown[] | Error) => ({
    get: jest.fn((token, options) => {
      expect([token, options]).toEqual([OPERATOR_CHECK, { strict: false, each: true }]);
      if (checks instanceof Error) {
        throw checks;
      }
      return checks;
    }),
  });

  it('answers with the rule on TR_EVER_ADMIN_EMAILS when no other module checks operators', () => {
    const service = new OperatorCheckService(moduleRef(new Error('not found')) as any);
    const operatorEmail = config.everPlatform.adminEmails[0];
    expect(service.isOperator(account(operatorEmail))).toBe(true);
    expect(service.isOperator(account(operatorEmail.toUpperCase()))).toBe(true);
    // Never an unverified account, another e-mail, an API key or nothing
    expect(service.isOperator(account(operatorEmail, false))).toBe(false);
    expect(service.isOperator(account('someone@test.com'))).toBe(false);
    expect(service.isOperator({ id: 'c1', email: operatorEmail, emailVerified: true })).toBe(false);
    expect(service.isOperator(undefined)).toBe(false);
  });

  it("uses the other module's check where one is loaded, never its own twice", () => {
    const other = { isOperator: jest.fn(() => true) };
    const refs = moduleRef([]);
    const service = new OperatorCheckService(refs as any);
    refs.get.mockImplementation(() => [service, other]);
    expect(service.isOperator(account('someone@test.com'))).toBe(true);
    expect(other.isOperator).toHaveBeenCalledTimes(1);

    refs.get.mockImplementation(() => [service]);
    expect(service.isOperator(account('someone@test.com'))).toBe(false);
  });
});

describe('the operator console', () => {
  const noOther = { get: () => [] };

  it('has no operator unless TR_EVER_ADMIN_EMAILS or TR_ADMIN_EMAIL names one, never the built-in fallback', () => {
    const service = new OperatorCheckService(noOther as any);
    const fallback = account('local.admin@ever.co');
    // The installation's check takes the fallback (the Ever Platform pages keep it) ...
    expect(config.everPlatform.adminEmails).toContain('local.admin@ever.co');
    expect(service.isOperator(fallback)).toBe(true);
    // ... the console does not, with neither variable set
    expect(explicitOperatorEmails({})).toEqual([]);
    expect(explicitOperatorEmails({ TR_EVER_ADMIN_EMAILS: ' ', TR_ADMIN_EMAIL: '' })).toEqual([]);
    expect(service.isConsoleOperator(fallback, {})).toBe(false);
    expect(service.isConsoleOperator(fallback, { TR_SAAS_ENABLED: 'true' })).toBe(false);
  });

  it('takes the accounts the environment names, verified only', () => {
    const service = new OperatorCheckService(noOther as any);
    const env = { TR_EVER_ADMIN_EMAILS: 'Local.Admin@ever.co, ops@ever.co' };
    expect(explicitOperatorEmails(env)).toEqual(['local.admin@ever.co', 'ops@ever.co']);
    expect(service.isConsoleOperator(account('local.admin@ever.co'), env)).toBe(true);
    expect(service.isConsoleOperator(account('local.admin@ever.co', false), env)).toBe(false);
    expect(explicitOperatorEmails({ TR_ADMIN_EMAIL: 'Admin@Example.com' })).toEqual(['admin@example.com']);
    // Listed, but not an operator of the installation: no
    expect(service.isConsoleOperator(account('ops@ever.co'), env)).toBe(false);
  });
});

describe('billing cancellation', () => {
  it('is a no-op without billing, and the billing module’s own when it is loaded', async () => {
    expect(billingCancellation(undefined)).toBe(NO_BILLING_CANCELLATION);
    const missing = {
      get: () => {
        throw new Error('not found');
      },
    };
    expect(billingCancellation(missing as any)).toBe(NO_BILLING_CANCELLATION);

    const billing = { cancelForDeletion: () => Promise.resolve() };
    expect(billingCancellation({ get: () => billing } as any)).toBe(billing);
  });

  /** An entity manager holding the outbox rows and the organizations, for the settlement */
  const store = (rows: Array<{ organizationId: string; status: string; attempts: number }>) => {
    const updates: Array<[string, object]> = [];
    const manager = {
      find: jest.fn(async () => rows.filter(row => row.status !== BillingCancellationStatus.Done)),
      findOne: jest.fn(async (_entity, options) => ({ id: options.where.id, status: 'deleted' })),
      update: jest.fn(async (_entity, where, changes) => void updates.push([where.organizationId, changes])),
    };
    return { manager, updates };
  };

  it('settles after the commit: done at the first success, the organization given as its tombstone', async () => {
    const seen: unknown[] = [];
    const billing = { cancelForDeletion: async organization => void seen.push(organization) };
    const { manager, updates } = store([{ organizationId: 'o1', status: 'pending', attempts: 0 }]);
    const settled = await settleBillingCancellations({ get: () => billing } as any, manager as any, ['o1'], [0, 0, 0]);
    expect([...settled]).toEqual([['o1', BillingCancellationStatus.Done]]);
    expect(seen).toEqual([{ id: 'o1', status: 'deleted' }]);
    expect(updates).toEqual([['o1', { status: BillingCancellationStatus.Done, attempts: 1, lastError: null }]]);
  });

  it('retries, then leaves a failure to the operators with its last error, and never throws', async () => {
    let calls = 0;
    const billing = {
      cancelForDeletion: async () => {
        calls += 1;
        throw new Error(`stripe is down ${calls}`);
      },
    };
    const { manager, updates } = store([{ organizationId: 'o1', status: 'failed', attempts: 3 }]);
    const settled = await settleBillingCancellations({ get: () => billing } as any, manager as any, ['o1', 'o1'], [0, 0, 0]);
    expect(calls).toBe(3);
    expect([...settled]).toEqual([['o1', BillingCancellationStatus.Failed]]);
    expect(updates).toEqual([['o1', { status: BillingCancellationStatus.Failed, attempts: 6, lastError: 'Error: stripe is down 3' }]]);
  });

  it('does nothing without a queued cancellation', async () => {
    const { manager, updates } = store([]);
    expect((await settleBillingCancellations(undefined, manager as any, [])).size).toBe(0);
    expect(manager.find).not.toHaveBeenCalled();
    expect((await settleBillingCancellations(undefined, manager as any, ['o1'])).size).toBe(0);
    expect(updates).toEqual([]);
  });
});

describe('organization deletion confirmation', () => {
  const organization = { isDefault: false, slug: 'acme-co' };

  it('needs the slug typed, spaces and case aside', () => {
    expect(() => assertDeletionConfirmed(organization, 'acme-co')).not.toThrow();
    expect(() => assertDeletionConfirmed(organization, '  ACME-co ')).not.toThrow();
    for (const typed of ['', 'acme', 'acme-co-', 'acme co', undefined, null, 42]) {
      expect(() => assertDeletionConfirmed(organization, typed)).toThrow(expect.objectContaining({ code: 'slug_mismatch' }));
    }
  });

  it('never deletes the default organization', () => {
    expect(() => assertDeletionConfirmed({ isDefault: true, slug: 'default' }, 'default')).toThrow(
      expect.objectContaining({ code: 'default_organization' }),
    );
  });
});

describe('the organization export layout', () => {
  it('names project folders by name and id, locale files by code, the archive by slug and day', () => {
    expect(pathSegment('Website (Prod) — Ünïcode', 'project')).toBe('website-prod-unicode');
    expect(pathSegment('***', 'project')).toBe('project');
    expect(pathSegment('a'.repeat(39) + '-b', 'project')).toBe('a'.repeat(39));
    expect(pathSegment('../../etc/passwd', 'project')).toBe('etc-passwd');
    expect(projectFolder({ id: 'p-1', name: 'My App' })).toBe('projects/my-app-p-1');
    expect(localeFile('pt_BR')).toBe('pt_BR.json');
    expect(localeFile('../x')).toBe('___x.json');
    expect(exportFileName({ slug: 'acme' }, new Date(Date.UTC(2026, 10, 28, 23, 59)))).toBe('acme-export-2026-11-28.zip');
  });
});

describe('the operator queries', () => {
  it('searches with a LIKE pattern whose wildcards in the text are literal', () => {
    expect(searchPattern('Acme')).toBe('%acme%');
    expect(searchPattern('first_last@')).toBe('%first!_last@%');
    expect(searchPattern('50%!off\\')).toBe('%50!%!!off\\%');
  });

  it('releases a slug for one no organization can take, of 40 characters', () => {
    const slug = releasedSlug('0F8FAD5B-D9CB-469F-A165-70867728950E');
    expect(slug).toBe('deleted-0f8fad5bd9cb469fa16570867728950e');
    expect(slug).toHaveLength(40);
  });

  it('reads page numbers within their bounds', () => {
    expect(pageNumber(undefined, 25, 100)).toBe(25);
    expect(pageNumber('3', 1, 100)).toBe(3);
    expect(pageNumber('500', 25, 100)).toBe(100);
    expect(pageNumber('0', 1, 100)).toBe(1);
    expect(pageNumber('x', 7, 100)).toBe(7);
  });
});

describe('the rate limit of organization changes', () => {
  // @nestjs/throttler keeps a @Throttle({ default: { limit, ttl } }) on the handler under these metadata keys
  const LIMIT_KEY = 'THROTTLER:LIMITdefault';
  const TTL_KEY = 'THROTTLER:TTLdefault';

  it.each([
    ['POST /organizations', () => OrganizationController.prototype.create],
    ['DELETE /organizations/:id', () => OrganizationDataController.prototype.delete],
  ])('%s takes TR_ORGANIZATION_CHANGES_LIMIT per TR_ORGANIZATION_CHANGES_TTL', (_route, handler) => {
    expect(Reflect.getMetadata(LIMIT_KEY, handler())).toBe(config.organizationChanges.limit);
    expect(Reflect.getMetadata(TTL_KEY, handler())).toBe(config.organizationChanges.ttl);
    expect(config.organizationChanges).toEqual({ limit: 10, ttl: 3_600_000 });
  });
});
