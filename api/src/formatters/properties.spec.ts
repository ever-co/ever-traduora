import { loadFixture, simpleFormatFixture } from './fixtures';
import { propertiesExporter, propertiesParser } from './properties';

test('should parse properties files', async () => {
  const input = loadFixture('simple.properties');
  const result = await propertiesParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should export properties files', async () => {
  const result = await propertiesExporter(simpleFormatFixture);
  const expected = loadFixture('simple.properties');
  expect(result).toEqual(expected);
});
