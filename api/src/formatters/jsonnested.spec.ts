import { loadFixture, simpleFormatFixture } from './fixtures';
import { jsonNestedExporter, jsonNestedParser } from './jsonnested';

test('should parse nested json files', async () => {
  const input = `{
      "term two": "hello there, all good?",
      "term.three.is..very.nested": "Export format...",
      "term": {
        "one": "Current Plan: {{ project.plan.name }}",
        "three": {
          "is": {
            "": {
              "very": {
                "nested too": "Another export format..."
              }
            }
          }
        }
      }
    }`;
  const result = await jsonNestedParser(input);
  expect(result).toEqual({
    translations: [
      {
        term: 'term two',
        translation: 'hello there, all good?',
      },
      {
        term: 'term.three.is..very.nested',
        translation: 'Export format...',
      },
      {
        term: 'term.one',
        translation: 'Current Plan: {{ project.plan.name }}',
      },
      {
        term: 'term.three.is..very.nested too',
        translation: 'Another export format...',
      },
    ],
  });
});

test('should fail if file is malformed or empty', async () => {
  const inputs = [
    '',
    '{ "term.one": "translation" ',
    '{ "term.one": }',
    '{ "term.one": null }',
    '{ "term.one": 123 }',
    '[ { "term.one": "ok?" } ]',
    '[ "hello" ]',
    '{ "term.one": { "nested": 123 } }',
  ];

  expect.assertions(inputs.length);

  for (const input of inputs) {
    await expect(jsonNestedParser(input)).rejects.toBeDefined();
  }
});

test('should fail if the nested JSON goes above 5 levels', async () => {
  const ok = '{ "0": { "1": { "2": { "3": { "4": { "5": "" } } } } } }';
  const tooMany = '{ "0": { "1": { "2": { "3": { "4": { "5": { "6": "" } } } } } } }';

  expect.assertions(2);
  await expect(jsonNestedParser(ok)).resolves.toBeDefined();
  await expect(jsonNestedParser(tooMany)).rejects.toBeDefined();
});

test('should export json nested files', async () => {
  const result = await jsonNestedExporter(simpleFormatFixture);
  const expected = loadFixture('simple-nested.json');
  expect(result).toEqual(expected);
});
