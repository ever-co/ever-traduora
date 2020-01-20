import { loadFixture, simpleFormatFixture } from './fixtures';
import { gettextExporter, gettextParser } from './gettext';

test('should parse gettext files', async () => {
  const input = loadFixture('simple.po');
  const result = await gettextParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should parse gettext files with context', async () => {
  const input = loadFixture('simple-context.po');
  const result = await gettextParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should export gettext files', async () => {
  const result = await gettextExporter({ ...simpleFormatFixture, iso: 'de_DE' });
  const expected = loadFixture('simple.po');
  expect(result).toEqual(expected);
});
