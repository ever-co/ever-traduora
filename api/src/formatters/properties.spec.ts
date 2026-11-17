import { loadFixture, simpleFormatFixture } from './fixtures';
import { propertiesExporter, propertiesParser } from './properties';

test('should parse properties files', async () => {
  const input = loadFixture('simple.properties');
  const result = await propertiesParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should keep every value as the exact text, without casting it to a number, boolean or null', async () => {
  const input = 'a=0\nb=false\nc=1.10\nd=007\ne=+33\nf=null\ng=true';
  const result = await propertiesParser(input);
  expect(result).toEqual({
    translations: [
      { term: 'a', translation: '0' },
      { term: 'b', translation: 'false' },
      { term: 'c', translation: '1.10' },
      { term: 'd', translation: '007' },
      { term: 'e', translation: '+33' },
      { term: 'f', translation: 'null' },
      { term: 'g', translation: 'true' },
    ],
  });
});

test('should keep hex, exponent, undefined and empty values as text', async () => {
  const input = 'hex=0x1F\nexp=1e3\nundef=undefined\nempty=\nbare\nspaced = 42 ';
  const result = await propertiesParser(input);
  expect(result).toEqual({
    translations: [
      { term: 'hex', translation: '0x1F' },
      { term: 'exp', translation: '1e3' },
      { term: 'undef', translation: 'undefined' },
      { term: 'empty', translation: '' },
      { term: 'bare', translation: '' },
      { term: 'spaced', translation: '42 ' },
    ],
  });
});

test('should keep comments, separators and line continuations as before', async () => {
  const lines = [
    '# a comment',
    '; another comment',
    'one = first',
    // ':' does not separate in strict mode
    'two:colon = second',
    'three = multi \\',
    '    line',
    // '!' does not start a comment in strict mode
    '! not a comment = 1',
  ];
  const input = lines.join('\n');
  const result = await propertiesParser(input);
  expect(result).toEqual({
    translations: [
      { term: 'one', translation: 'first' },
      { term: 'two:colon', translation: 'second' },
      { term: 'three', translation: 'multi line' },
      { term: '!', translation: 'not a comment = 1' },
    ],
  });
});

test('should encode and decode properties files with ISO-8859-1 by default', async () => {
  const encodedLiteral = String.raw`term.one = Tous les soci\u00e9t\u00e9s`;

  const decoded = {
    translations: [
      {
        term: 'term.one',
        translation: 'Tous les sociétés',
      },
    ],
  };

  {
    const result = await propertiesParser(encodedLiteral);
    expect(result).toEqual(decoded);
  }

  {
    const result = await propertiesExporter(decoded);
    expect(result).toEqual(encodedLiteral);
  }
});

test('should export properties files', async () => {
  const result = await propertiesExporter(simpleFormatFixture);
  const expected = loadFixture('simple.properties');
  expect(result.toString()).toEqual(expected);
});
