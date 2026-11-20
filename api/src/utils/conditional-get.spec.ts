import { computeEtag, ifNoneMatchMatches } from './conditional-get';

describe('computeEtag', () => {
  it('returns the same quoted tag for the same content', () => {
    const tag = computeEtag('{"a":"b"}');
    expect(tag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(computeEtag('{"a":"b"}')).toBe(tag);
    expect(computeEtag(Buffer.from('{"a":"b"}'))).toBe(tag);
  });

  it('returns a different tag when the content changes', () => {
    expect(computeEtag('{"a":"b"}')).not.toBe(computeEtag('{"a":"c"}'));
  });
});

describe('ifNoneMatchMatches', () => {
  const etag = computeEtag('content');

  it('does not match when the header is absent or empty', () => {
    expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
    expect(ifNoneMatchMatches('', etag)).toBe(false);
  });

  it('matches the exact tag', () => {
    expect(ifNoneMatchMatches(etag, etag)).toBe(true);
  });

  it('does not match a different tag', () => {
    expect(ifNoneMatchMatches('"other"', etag)).toBe(false);
  });

  it('matches a weak validator of the same tag', () => {
    expect(ifNoneMatchMatches(`W/${etag}`, etag)).toBe(true);
  });

  it('finds the tag in a comma separated list and in repeated headers', () => {
    expect(ifNoneMatchMatches(`"one", ${etag} ,"two"`, etag)).toBe(true);
    expect(ifNoneMatchMatches(['"one"', etag], etag)).toBe(true);
    expect(ifNoneMatchMatches('"one", "two"', etag)).toBe(false);
  });

  it('matches the wildcard', () => {
    expect(ifNoneMatchMatches('*', etag)).toBe(true);
  });
});
