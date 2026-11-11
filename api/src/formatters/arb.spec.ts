import { simpleFormatFixture } from './fixtures';
import { arbExporter, arbParser } from './arb';

test('should parse arb files and skip metadata keys', async () => {
  const input = `{
    "@@locale": "en",
    "@@last_modified": "2024-01-01T00:00:00.000Z",
    "greeting": "Hello {name}",
    "@greeting": {
      "description": "Greets the user",
      "placeholders": { "name": { "type": "String" } }
    },
    "farewell": "Bye"
  }`;

  const result = await arbParser(input);
  expect(result).toEqual({
    translations: [
      { term: 'greeting', translation: 'Hello {name}' },
      { term: 'farewell', translation: 'Bye' },
    ],
  });
});

test('should keep plain flat json keys that do not start with @', async () => {
  const result = await arbParser('{ "term.one": "one", "email@domain": "two" }');
  expect(result.translations).toEqual([
    { term: 'term.one', translation: 'one' },
    { term: 'email@domain', translation: 'two' },
  ]);
});

test('should parse an arb file with only metadata as empty', async () => {
  expect(await arbParser('{ "@@locale": "de" }')).toEqual({ translations: [] });
});

test('should fail if arb file is malformed, invalid or empty', async () => {
  const inputs = [
    '',
    '{ "term.one": "translation" ',
    'null',
    '"text"',
    '{ "term.one": {} }',
    '{ "term.one": null }',
    '{ "term.one": 123 }',
    '[ { "term.one": "ok?" } ]',
    '[ "hello" ]',
  ];

  expect.assertions(inputs.length);

  for (const input of inputs) {
    await expect(arbParser(input)).rejects.toBeDefined();
  }
});

test('should export arb files with the locale', async () => {
  const result = await arbExporter({ ...simpleFormatFixture, iso: 'de_DE' });
  expect(JSON.parse(result as string)).toEqual({
    '@@locale': 'de_DE',
    'term.one': 'Current Plan: {{ project.plan.name }}',
    'term two': '{VAR_PLURAL, plural, =0 {locales} =1 {locale} other {locales} }',
    TERM_THREE: 'Export format...',
    'term:four': 'hello there you\\nthis should be in a newline',
  });
});

test('should export arb files without a locale when none is given', async () => {
  const result = await arbExporter({ translations: [{ term: 'a', translation: 'b' }] });
  expect(JSON.parse(result as string)).toEqual({ a: 'b' });
});

test('should leave terms starting with @ out of the export so they cannot clash with metadata', async () => {
  const exported = await arbExporter({
    iso: 'en',
    translations: [
      { term: '@@locale', translation: 'xx' },
      { term: '@greeting', translation: 'meta' },
      { term: 'email@domain', translation: 'kept' },
    ],
  });
  expect(JSON.parse(exported as string)).toEqual({ '@@locale': 'en', 'email@domain': 'kept' });
});

test('should round trip arb files', async () => {
  const exported = await arbExporter({ iso: 'en', translations: simpleFormatFixture.translations });
  const parsed = await arbParser(exported as string);
  expect(parsed.translations).toEqual(simpleFormatFixture.translations);
});

test('should keep a __proto__ term as an ordinary key', async () => {
  const exported = await arbExporter({ translations: [{ term: '__proto__', translation: 'x' }] });
  expect(Object.keys(JSON.parse(exported as string))).toEqual(['__proto__']);
});
