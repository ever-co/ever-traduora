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

  it('says which organization stands in the way of deleting the account, and what to do first', () => {
    const refusal = (code: string, message?: string) => ({ status: 422, error: { error: { code, ...(message ? { message } : {}) } } });
    expect(
      errorToMessage(
        refusal('subscription_active', "'Acme' has a paid subscription. Cancel it under Billing, Manage billing, before deleting your account"),
        'DeleteAccount',
      ),
    ).toBe("'Acme' has a paid subscription. Cancel it under Billing, Manage billing, before deleting your account");
    expect(errorToMessage(refusal('subscription_active'), 'DeleteAccount')).toContain('Cancel it under Billing');
    expect(errorToMessage(refusal('owner_required'), 'DeleteAccount')).toContain('Transfer its ownership');
    // The other refusal of the deletion keeps its message
    expect(errorToMessage({ status: 422, error: { error: { code: 'UnprocessableEntity' } } }, 'DeleteAccount')).toContain('last admin');
  });

  it('keeps the message of a project plan (single-tenant install)', () => {
    expect(errorToMessage({ status: 402, error: { error: { code: 'PaymentRequired' } } })).toContain('current project plan');
  });
});
