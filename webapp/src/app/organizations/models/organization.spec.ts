import { canManage, isAllowedSlug, slugFromName } from './organization';

describe('organization model', () => {
  it('suggests the slug the API would derive', () => {
    expect(slugFromName('Acme GmbH & Co.')).toBe('acme-gmbh-co');
    expect(slugFromName('Café Zürich')).toBe('cafe-zurich');
    expect(slugFromName('  ')).toBe('');
  });

  it('allows the same slugs as the API', () => {
    expect(isAllowedSlug('acme')).toBe(true);
    for (const slug of ['ab', 'admin', 'default', 'a--b', '-abc', 'abc-', 'Acme', 'x'.repeat(41)]) {
      expect(isAllowedSlug(slug)).withContext(slug).toBe(false);
    }
  });

  it('lets owners and admins manage, not members', () => {
    expect(canManage('owner')).toBe(true);
    expect(canManage('admin')).toBe(true);
    expect(canManage('member')).toBe(false);
    expect(canManage(undefined)).toBe(false);
  });
});
