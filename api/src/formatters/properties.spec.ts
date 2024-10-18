import { loadFixture, simpleFormatFixture } from './fixtures';
import { propertiesExporter, propertiesParser } from './properties';

test('should parse properties files', async () => {
  const input = loadFixture('simple.properties');
  const result = await propertiesParser(input);
  expect(result).toEqual(simpleFormatFixture);
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
