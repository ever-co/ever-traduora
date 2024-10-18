import { toEqualIgnoringIndentation } from './util';
import { loadFixture, simpleFormatFixture } from './fixtures';
import { jsonFlatExporter, jsonFlatParser } from './jsonflat';

expect.extend(toEqualIgnoringIndentation);

test('should parse json flat files', async () => {
  const input = `{
      "term.one": "Current Plan: {{ project.plan.name }}",
      "term two": "hello there, all good?",
      "TERM_THREE": "Export format..."
  }`;

  const result = await jsonFlatParser(input);
  expect(result).toEqual({
    translations: [
      {
        term: 'term.one',
        translation: 'Current Plan: {{ project.plan.name }}',
      },
      {
        term: 'term two',
        translation: 'hello there, all good?',
      },
      {
        term: 'TERM_THREE',
        translation: 'Export format...',
      },
    ],
  });
});

test('should fail if file is malformed, invalid or empty', async () => {
  const inputs = [
    '',
    '{ "term.one": "translation" ',
    '{ "term.one": }',
    '{ "term.one": {} }',
    '{ "term.one": null }',
    '{ "term.one": 123 }',
    '[ { "term.one": "ok?" } ]',
    '[ "hello" ]',
    '{ "term.one": { "nested": "term" } }',
  ];

  expect.assertions(inputs.length);

  for (const input of inputs) {
    await expect(jsonFlatParser(input)).rejects.toBeDefined();
  }
});

test('should export jsonflat files', async () => {
  const result = await jsonFlatExporter(simpleFormatFixture);
  const expected = loadFixture('simple-flat.json');
  expect(result).toEqualIgnoringIndentation(expected);
});
