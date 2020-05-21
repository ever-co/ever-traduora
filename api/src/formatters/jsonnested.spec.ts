import { config } from '../config';
import { loadFixture, simpleFormatFixture } from './fixtures';
import { jsonNestedExporter, jsonNestedParser } from './jsonnested';
import { load } from 'js-yaml';
import { IntermediateTranslationFormat } from '../domain/formatters';

test('should parse nested strings with matching function names', async () => {
  const inputFlat = loadFixture('function-name-flat.json');

  const inputNested = loadFixture('function-name-nested.json');

  const expected = {
    translations: [
      {
        term: 'term.one',
        translation: 'data.VWAnalyticssaleorder.docdate.day',
      },
      {
        term: 'term.two.hour',
        translation: 'data.VWAnalyticssaleorder.docdate',
      },
      {
        term: 'term.three',
        translation: 'UPDATE_SCHEDULER_SCREEN.EDIT_EVENT.HOURS',
      },
      {
        term: 'data.VWAnalyticssaleorder.docdate.day',
        translation: 'foo',
      },
      {
        term: 'UPDATE_SCHEDULER_SCREEN.EDIT_EVENT.HOURS',
        translation: 'bar',
      },
    ],
  };

  const resultFlat = await jsonNestedParser(inputFlat);
  expect(resultFlat).toEqual(expected);

  const resultNested = await jsonNestedParser(inputNested);
  expect(resultNested).toEqual(expected);
});

test('should export nested strings with matching function names', async () => {
  const input = {
    translations: [
      {
        term: 'term.one',
        translation: 'data.VWAnalyticssaleorder.docdate.day',
      },
      {
        term: 'term.two.hour',
        translation: 'data.VWAnalyticssaleorder.docdate',
      },
      {
        term: 'term.three',
        translation: 'UPDATE_SCHEDULER_SCREEN.EDIT_EVENT.HOURS',
      },
      {
        term: 'data.VWAnalyticssaleorder.docdate.day',
        translation: 'foo',
      },
      {
        term: 'UPDATE_SCHEDULER_SCREEN.EDIT_EVENT.HOURS',
        translation: 'bar',
      },
    ],
  };
  const result = await jsonNestedExporter(input);

  const expected = loadFixture('function-name-nested.json');

  expect(result).toEqual(expected);
});

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

test('should fail if the nested JSON goes above max levels', async () => {
  const ok = '{ "0": { "1": { "2": { "3": { "4": { "5": "" } } } } } }';

  const tooManyRoot = {};
  let next = tooManyRoot;
  for (let i = 0; i < config.import.maxNestedLevels + 1; i++) {
    const key = i.toString();
    next[key] = {};
    next = next[key];
  }
  const tooMany = JSON.stringify(tooManyRoot);

  expect.assertions(2);
  await expect(jsonNestedParser(ok)).resolves.toBeDefined();
  await expect(jsonNestedParser(tooMany)).rejects.toBeDefined();
});

test('should export json nested files', async () => {
  const result = await jsonNestedExporter(simpleFormatFixture);
  const expected = loadFixture('simple-nested.json');
  expect(result).toEqual(expected);
});

test('should fail with conflicting nested object on export', async () => {
  const input: IntermediateTranslationFormat = {
    translations: [
      {
        term: 'button',
        translation: 'Botón',
      },
      {
        term: 'button.test',
        translation: 'Botón de prueba',
      },
    ],
  };
  await expect(jsonNestedExporter(input)).rejects.toBeDefined();
});
