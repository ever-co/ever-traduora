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

test('should read back a value made only of spaces', async () => {
  const exported = await resXExporter({ iso: 'en', translations: [{ term: 'space', translation: ' ' }] });
  const result = await resXParser(exported as string);
  expect(result.translations).toEqual([{ term: 'space', translation: ' ' }]);
});

test('should keep the space between two CDATA sections', async () => {
  const result = await resXParser(resxWithData('<data name="cdata" xml:space="preserve"><value><![CDATA[Hello]]> <![CDATA[world]]></value></data>'));
  expect(result.translations).toEqual([{ term: 'cdata', translation: 'Hello world' }]);
});

test('should export a term with &, < and > as well-formed XML and read it back', async () => {
  const exported = await resXExporter({ iso: 'en', translations: [{ term: 'Terms & <Conditions> "q"', translation: 'x' }] });
  const result = await resXParser(exported as string);
  expect(result.translations).toEqual([{ term: 'Terms & <Conditions> "q"', translation: 'x' }]);
});

const ampersands = [
  { term: 'entity', translation: '&amp;' },
  { term: 'double', translation: 'a &amp;amp; b' },
  { term: 'plain', translation: 'Tom & Jerry' },
];

test('should export a translation holding "&amp;" with every & escaped and read it back unchanged', async () => {
  const exported = (await resXExporter({ iso: 'en', translations: ampersands })) as string;
  expect(exported).toContain('<value>&amp;amp;</value>');
  expect(exported).toContain('<value>a &amp;amp;amp; b</value>');
  expect(exported).toContain('<value>Tom &amp; Jerry</value>');
  const result = await resXParser(exported);
  expect(result.translations).toEqual(ampersands);
});

test('should still export an empty translation as an empty value element', async () => {
  const exported = await resXExporter({ iso: 'en', translations: [{ term: 'empty', translation: '' }] });
  expect(exported).toContain('<data name="empty" xml:space="preserve">\n    <value/>\n  </data>');
});

test('should export a term with a tab, a line break and a carriage return as character references and read it back', async () => {
  const term = 'a\tb\nc\rd';
  const exported = (await resXExporter({ iso: 'en', translations: [{ term, translation: 'x' }] })) as string;
  expect(exported).toContain('<data name="a&#9;b&#10;c&#13;d" xml:space="preserve">');
  const result = await resXParser(exported);
  expect(result.translations).toEqual([{ term, translation: 'x' }]);
});
