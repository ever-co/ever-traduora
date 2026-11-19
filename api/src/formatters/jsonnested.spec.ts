import { toEqualIgnoringIndentation } from './util';
import { config } from '../config';
import { loadFixture, simpleFormatFixture } from './fixtures';
import { jsonNestedExporter, jsonNestedParser } from './jsonnested';
import { NestedKeyConflictError } from './nested-key-conflict';
import { IntermediateTranslation, IntermediateTranslationFormat } from '../domain/formatters';

expect.extend(toEqualIgnoringIndentation);

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

  expect(result).toEqualIgnoringIndentation(expected);
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
  expect(result).toEqualIgnoringIndentation(expected);
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
  await expect(jsonNestedExporter(input)).rejects.toBeInstanceOf(NestedKeyConflictError);
  await expect(jsonNestedExporter(input)).rejects.toThrow('"button"');
});

test('should export a term named hasOwnProperty next to nested terms', async () => {
  const input: IntermediateTranslationFormat = {
    translations: [
      { term: 'hasOwnProperty', translation: 'own' },
      { term: 'home.title', translation: 'Home' },
    ],
  };
  const result = await jsonNestedExporter(input);
  expect(JSON.parse(result.toString())).toEqual({ hasOwnProperty: 'own', home: { title: 'Home' } });
});

// On a plain object, obj['__proto__'] = value calls the prototype setter and adds no key, so these terms were dropped
const protoCases: { name: string; translations: IntermediateTranslation[]; expected: string }[] = [
  {
    name: 'a term under __proto__ next to another term',
    translations: [
      { term: '__proto__.x', translation: 'X' },
      { term: 'a', translation: 'A' },
    ],
    expected: '{ "__proto__": { "x": "X" }, "a": "A" }',
  },
  {
    name: 'a term named __proto__',
    translations: [{ term: '__proto__', translation: 'P' }],
    expected: '{ "__proto__": "P" }',
  },
  {
    name: 'a term ending in __proto__',
    translations: [{ term: 'a.__proto__', translation: 'A' }],
    expected: '{ "a": { "__proto__": "A" } }',
  },
];

test.each(protoCases)('should export and parse back $name', async ({ translations, expected }) => {
  const result = await jsonNestedExporter({ translations });
  expect(result).toEqualIgnoringIndentation(expected);

  const parsed = await jsonNestedParser(result.toString());
  expect(parsed.translations).toEqual(translations);
});
