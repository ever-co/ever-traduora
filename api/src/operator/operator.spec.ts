import { OPERATOR_CHECK } from '../access/operator-check';
import { config } from '../config';
import { User } from '../entity/user.entity';
import { billingCancellation, cancelSubscriptions, NO_BILLING_CANCELLATION } from '../services/organization/billing-cancellation';
import { exportFileName, localeFile, pathSegment, projectFolder } from '../services/organization/organization-export.service';
import { assertDeletionConfirmed } from '../services/organization/organization-membership';
import { searchPattern } from '../services/organization/organization-operator.service';
import { OperatorCheckService } from './operator-check.service';
import { pageNumber } from './operator.dto';

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

describe('billing cancellation', () => {
  it('is a no-op without billing, and the billing module’s own when it is loaded', async () => {
    expect(billingCancellation(undefined)).toBe(NO_BILLING_CANCELLATION);
    const missing = {
      get: () => {
        throw new Error('not found');
      },
    };
    expect(billingCancellation(missing as any)).toBe(NO_BILLING_CANCELLATION);

    const calls: string[] = [];
    const billing = { cancelForDeletion: async organization => void calls.push(organization.id) };
    const loaded = { get: () => billing };
    expect(billingCancellation(loaded as any)).toBe(billing);
    await cancelSubscriptions(loaded as any, [{ id: 'o1' } as any, { id: 'o2' } as any]);
    expect(calls).toEqual(['o1', 'o2']);
  });

  it('stops at the first failure', async () => {
    const calls: string[] = [];
    const billing = {
      cancelForDeletion: async organization => {
        calls.push(organization.id);
        throw new Error('stripe is down');
      },
    };
    await expect(cancelSubscriptions({ get: () => billing } as any, [{ id: 'o1' } as any, { id: 'o2' } as any])).rejects.toThrow('stripe is down');
    expect(calls).toEqual(['o1']);
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
  it('searches with a LIKE pattern that keeps no wildcard of the text', () => {
    expect(searchPattern('Acme')).toBe('%acme%');
    expect(searchPattern('50%_off\\')).toBe('%50off%');
  });

  it('reads page numbers within their bounds', () => {
    expect(pageNumber(undefined, 25, 100)).toBe(25);
    expect(pageNumber('3', 1, 100)).toBe(3);
    expect(pageNumber('500', 25, 100)).toBe(100);
    expect(pageNumber('0', 1, 100)).toBe(1);
    expect(pageNumber('x', 7, 100)).toBe(7);
  });
});
