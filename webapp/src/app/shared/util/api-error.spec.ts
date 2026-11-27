import { errorToMessage } from './api-error';

describe('errorToMessage', () => {
  const planLimit = (body: object) => ({ status: 402, error: { error: { code: 'plan_limit_reached', ...body } } });

  it("says what the organization's plan allows on a plan limit, for every action", () => {
    expect(errorToMessage(planLimit({ resource: 'seats', limit: 15, used: 15, plan: 'starter' }), 'InviteProjectUser')).toBe(
      'Your plan allows 15 members. Upgrade to add more.',
    );
    expect(errorToMessage(planLimit({ resource: 'strings', limit: 10000, used: 10000, plan: 'starter' }), 'ImportLocale')).toBe(
      'Your plan allows 10,000 strings. Upgrade to add more.',
    );
    expect(errorToMessage(planLimit({ resource: 'strings' }))).toBe('Your plan has no room for more strings. Upgrade to add more.');
  });

  it('keeps the message of a project plan (single-tenant install)', () => {
    expect(errorToMessage({ status: 402, error: { error: { code: 'PaymentRequired' } } })).toContain('current project plan');
  });
});
