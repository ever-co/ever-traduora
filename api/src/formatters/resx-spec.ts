import { loadFixture, simpleFormatFixture } from './fixtures';
import { resXExporter, resXParser } from './resx';

test('should parse resx resources files', async () => {
  const input = loadFixture('resx-in.resx');
  const result = await resXParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should export resx resources files', async () => {
  const result = await resXExporter({ ...simpleFormatFixture, iso: 'de_DE' });
  const expected = loadFixture('simple-resx.resx');
  expect(result).toEqual(expected);
});
