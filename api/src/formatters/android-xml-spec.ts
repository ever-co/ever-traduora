import { loadFixture, simpleFormatFixture } from './fixtures';
import { androidXmlExporter, androidXmlParser } from './android-xml';
import * as _ from 'lodash';

test('should parse android resources files', async () => {
  const input = loadFixture('simple-android.xml');
  const result = await androidXmlParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should parse and export android resources files with quotes', async () => {
  const input = loadFixture('android-quotes-in.xml');
  const parsed = await androidXmlParser(input);

  expect(parsed.translations).toHaveLength(5);

  const byTerm = _.keyBy(parsed.translations, 'term');

  expect(byTerm['term.one'].translation).toEqual("I'm a translation with a quote");
  expect(byTerm['term.two'].translation).toEqual("I'm a translation with a double quote");
  expect(byTerm['term.three'].translation).toEqual('I\'m a mixed translation with an escaped "double quote" and two single \' quotes');
  expect(byTerm['term.four'].translation).toEqual('The special chars are @ ? < & \' and "');
  expect(byTerm['term.five'].translation).toEqual('I\'m one "funny looking" translation...');

  const exported = await androidXmlExporter({ ...parsed, iso: 'de_DE' });

  expect(exported).toEqual(loadFixture('android-quotes-out.xml'));
});

describe('android resources with markup', () => {
  const parseMarkupFixture = async () => _.keyBy((await androidXmlParser(loadFixture('android-markup-in.xml'))).translations, 'term');

  test('should keep the content of a CDATA string', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.a.translation).toEqual('<b>Hi</b>');
  });

  test('should replace an xliff:g element by its content', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.b.translation).toEqual('Hello %1$s!');
  });

  test('should keep inline tags and the text after them', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.inline.translation).toEqual('Hello <b>World</b>, ok');
  });

  test('should skip resources that are not strings', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.c).toBeUndefined();
  });

  test('should keep the space between two inline tags', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.spaced.translation).toEqual('%1$s %2$s');
  });

  test('should keep a space that is the whole content of an inline tag', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.tagspace.translation).toEqual('Hello<b> </b>world');
  });

  test('should unescape the text and replace xliff:g inside an inline tag', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.nested.translation).toEqual("It's <b>Bob's %1$s</b>");
  });

  test('should drop the layout around a CDATA string', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.pretty.translation).toEqual('<i>Hi</i>');
  });

  test('should read an item of type string', async () => {
    const byTerm = await parseMarkupFixture();
    expect(byTerm.item.translation).toEqual('An item');
  });
});

test('should export android resources files', async () => {
  const result = await androidXmlExporter({ ...simpleFormatFixture, iso: 'de_DE' });
  const expected = loadFixture('simple-android.xml');
  expect(result).toEqual(expected);
});

test('should export a term with &, < and > as well-formed XML and read it back', async () => {
  const exported = await androidXmlExporter({ iso: 'en', translations: [{ term: 'Terms & <Conditions> "q"', translation: 'x' }] });
  const result = await androidXmlParser(exported as string);
  expect(result.translations).toEqual([{ term: 'Terms & <Conditions> "q"', translation: 'x' }]);
});

const ampersands = [
  { term: 'entity', translation: '&amp;' },
  { term: 'double', translation: 'a &amp;amp; b' },
  { term: 'plain', translation: 'Tom & Jerry' },
];

test('should export a translation holding "&amp;" with every & escaped and read it back unchanged', async () => {
  const exported = (await androidXmlExporter({ iso: 'en', translations: ampersands })) as string;
  expect(exported).toContain('<string name="entity">&amp;amp;</string>');
  expect(exported).toContain('<string name="double">a &amp;amp;amp; b</string>');
  expect(exported).toContain('<string name="plain">Tom &amp; Jerry</string>');
  const result = await androidXmlParser(exported);
  expect(result.translations).toEqual(ampersands);
});

test('should still export an empty translation as an empty string element', async () => {
  const exported = await androidXmlExporter({ iso: 'en', translations: [{ term: 'empty', translation: '' }] });
  expect(exported).toEqual('<?xml version="1.0" encoding="utf-8"?><resources><string name="empty"></string></resources>');
});

test('should export a term with a tab, a line break and a carriage return as character references and read it back', async () => {
  const term = 'a\tb\nc\rd';
  const exported = (await androidXmlExporter({ iso: 'en', translations: [{ term, translation: 'x' }] })) as string;
  expect(exported).toContain('<string name="a&#9;b&#10;c&#13;d">x</string>');
  const result = await androidXmlParser(exported);
  expect(result.translations).toEqual([{ term, translation: 'x' }]);
});

test('should keep an escaped "&amp;" inside an inline tag when parsing', async () => {
  const result = await androidXmlParser('<?xml version="1.0" encoding="utf-8"?><resources><string name="b"><b>&amp;amp;</b></string></resources>');
  expect(result.translations).toEqual([{ term: 'b', translation: '<b>&amp;amp;</b>' }]);
});
