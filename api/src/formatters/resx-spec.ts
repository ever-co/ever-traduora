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

const resxWithData = (data: string) => `<?xml version="1.0" encoding="utf-8"?>\n<root>\n  ${data}\n</root>`;

test('should export quotes, question marks and @ without backslashes', async () => {
  const result = await resXExporter({ iso: 'en', translations: [{ term: 'q', translation: `Are you sure? Don't say "hi" @me` }] });
  expect(result).toContain(`<value>Are you sure? Don't say "hi" @me</value>`);
});

test('should parse an empty value as an empty translation', async () => {
  const result = await resXParser(resxWithData('<data name="empty" xml:space="preserve"><value /></data>'));
  expect(result.translations).toEqual([{ term: 'empty', translation: '' }]);
});

test('should keep double quotes when parsing', async () => {
  const result = await resXParser(resxWithData('<data name="quote" xml:space="preserve"><value>Say "hi"</value></data>'));
  expect(result.translations).toEqual([{ term: 'quote', translation: 'Say "hi"' }]);
});

test('should read the value element after a comment and keep CDATA text', async () => {
  const result = await resXParser(
    resxWithData('<data name="commented" xml:space="preserve"><comment>A note</comment><value>Tom &amp; <![CDATA[<b>Jerry</b>]]></value></data>'),
  );
  expect(result.translations).toEqual([{ term: 'commented', translation: 'Tom & <b>Jerry</b>' }]);
});
