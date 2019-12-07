import { loadFixture, simpleFormatFixture } from './fixtures';
import { androidXmlExporter, androidXmlParser } from './android-xml';

test('should parse android resources files', async () => {
  const input = loadFixture('simple-android.xml');
  const result = await androidXmlParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should export android resources files', async () => {
  const result = await androidXmlExporter({ ...simpleFormatFixture, iso: 'de_DE' });
  const expected = loadFixture('simple-android.xml');
  expect(result).toEqual(expected);
});
