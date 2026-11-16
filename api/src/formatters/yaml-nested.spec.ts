import * as yaml from 'js-yaml';
import { IntermediateTranslationFormat } from '../domain/formatters';
import { loadFixture, simpleFormatFixture } from './fixtures';
import { NestedKeyConflictError } from './nested-key-conflict';
import { yamlNestedExporter, yamlNestedParser } from './yaml-nested';

test('should parse yaml nested files', async () => {
  const input = `
      term:
        one: 'Current Plan: {{ project.plan.name }}'
      term two: hello there, all good?
      TERM_THREE: Export format...
  `;

  const result = await yamlNestedParser(input);
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
    'term.one:\ntranslation',
    'term.one: Current Plan: {{ project.plan.name }}',
    'term.one',
    'term.one: null',
    'term.one: 123',
    '[ { term.one: ok? } ]',
    '[ hello ]',
    'term.one: nested: term',
  ];

  expect.assertions(inputs.length);

  for (const input of inputs) {
    await expect(yamlNestedParser(input)).rejects.toBeDefined();
  }
});

test('should export yaml nested files', async () => {
  const result = (await yamlNestedExporter(simpleFormatFixture)).toString().split(/\r?\n/).filter(Boolean);
  const expected = loadFixture('simple-nested.yaml').split(/\r?\n/).filter(Boolean);
  expect(result).toEqual(expected);
});

test('should fail with conflicting nested object on export', async () => {
  const input: IntermediateTranslationFormat = {
    translations: [
      { term: 'button', translation: 'Botón' },
      { term: 'button.test', translation: 'Botón de prueba' },
    ],
  };
  await expect(yamlNestedExporter(input)).rejects.toBeInstanceOf(NestedKeyConflictError);
  await expect(yamlNestedExporter(input)).rejects.toThrow('"button"');
});

test('should export a term named hasOwnProperty next to nested terms', async () => {
  const input: IntermediateTranslationFormat = {
    translations: [
      { term: 'hasOwnProperty', translation: 'own' },
      { term: 'home.title', translation: 'Home' },
    ],
  };
  const result = await yamlNestedExporter(input);
  expect(yaml.load(result.toString())).toEqual({ hasOwnProperty: 'own', home: { title: 'Home' } });
});
