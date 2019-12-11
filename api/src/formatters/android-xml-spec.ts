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

test('should export android resources files', async () => {
  const result = await androidXmlExporter({ ...simpleFormatFixture, iso: 'de_DE' });
  const expected = loadFixture('simple-android.xml');
  expect(result).toEqual(expected);
});
