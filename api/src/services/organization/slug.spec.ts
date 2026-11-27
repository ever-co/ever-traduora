import { isAllowedSlug, isWellFormedSlug, RESERVED_SLUGS, slugFromName, withSuffix } from './slug';

describe('organization slugs', () => {
  it('takes 3 to 40 lowercase letters, digits and single inner hyphens', () => {
    for (const slug of ['abc', 'acme-gmbh', 'a1-b2-c3', 'x'.repeat(40)]) {
      expect([slug, isWellFormedSlug(slug)]).toEqual([slug, true]);
    }
    for (const slug of ['ab', 'x'.repeat(41), '-abc', 'abc-', 'a--b', 'Acme', 'ac_me', 'ac me', 'é-abc', '']) {
      expect([slug, isWellFormedSlug(slug)]).toEqual([slug, false]);
    }
  });

  it('refuses the reserved words', () => {
    for (const slug of RESERVED_SLUGS) {
      expect(isWellFormedSlug(slug)).toBe(slug.length >= 3);
      expect(isAllowedSlug(slug)).toBe(false);
    }
    expect(RESERVED_SLUGS.has('default')).toBe(true);
    expect(isAllowedSlug('acme')).toBe(true);
  });

  it('derives an allowed slug from any name', () => {
    expect(slugFromName('Acme GmbH & Co.')).toBe('acme-gmbh-co');
    expect(slugFromName('Café Zürich')).toBe('cafe-zurich');
    expect(slugFromName("Ada Lovelace's organization")).toBe('ada-lovelace-s-organization');
    expect(slugFromName('A', () => 'abc123')).toBe('a-abc123');
    expect(slugFromName('', () => 'abc123')).toBe('org-abc123');
    expect(slugFromName('漢字', () => 'abc123')).toBe('org-abc123');
    expect(slugFromName('Admin', () => 'abc123')).toBe('admin-abc123');
    const long = slugFromName('word '.repeat(30));
    expect(long.length).toBeLessThanOrEqual(40);
    for (const name of ['Acme', 'x', '---', 'Default', 'Ünïcödé Ltd', 'a'.repeat(100), 'a - - b']) {
      expect([name, isAllowedSlug(slugFromName(name))]).toEqual([name, true]);
    }
  });

  it('keeps a suffixed slug within the length', () => {
    const slug = withSuffix('a'.repeat(40), 'abc123');
    expect(slug).toHaveLength(40);
    expect(slug.endsWith('-abc123')).toBe(true);
    expect(isAllowedSlug(withSuffix('abc-def-', 'x1y2z3'))).toBe(true);
  });
});
