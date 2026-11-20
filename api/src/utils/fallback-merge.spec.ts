import { mergeWithFallback } from './fallback-merge';

describe('mergeWithFallback', () => {
  const fallback = [
    { term: 'a', translation: 'fallback a' },
    { term: 'b', translation: 'fallback b' },
    { term: 'c', translation: 'fallback c' },
  ];

  it('matches by term when the locale has not translated the first terms', () => {
    // The locale's list leaves out the untranslated term 'a', so its entries are shifted against the fallback's
    const primary = [
      { term: 'b', translation: 'own b' },
      { term: 'c', translation: 'own c' },
    ];
    expect(mergeWithFallback(fallback, primary)).toEqual([
      { term: 'a', translation: 'fallback a' },
      { term: 'b', translation: 'own b' },
      { term: 'c', translation: 'own c' },
    ]);
  });

  it('keeps the fallback for terms the locale has not translated', () => {
    const primary = [{ term: 'c', translation: 'own c' }];
    expect(mergeWithFallback(fallback, primary)).toEqual([
      { term: 'a', translation: 'fallback a' },
      { term: 'b', translation: 'fallback b' },
      { term: 'c', translation: 'own c' },
    ]);
  });

  it('returns the fallback unchanged when the locale has nothing', () => {
    expect(mergeWithFallback(fallback, [])).toEqual(fallback);
  });

  it('returns the locale own translations when all are present', () => {
    const primary = fallback.map(e => ({ term: e.term, translation: `own ${e.term}` }));
    expect(mergeWithFallback(fallback, primary)).toEqual(primary);
  });

  it('does not change its inputs', () => {
    const primary = [{ term: 'b', translation: 'own b' }];
    mergeWithFallback(fallback, primary);
    expect(fallback[1]).toEqual({ term: 'b', translation: 'fallback b' });
    expect(primary).toEqual([{ term: 'b', translation: 'own b' }]);
  });
});
