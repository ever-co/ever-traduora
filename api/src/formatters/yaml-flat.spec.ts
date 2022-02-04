import { loadFixture, simpleFormatFixture } from './fixtures';
import { yamlFlatExporter, yamlFlatParser } from './yaml-flat';

test('should parse yaml flat files', async () => {
  const input = `
      term.one: 'Current Plan: {{ project.plan.name }}'
      term two: hello there, all good?
      TERM_THREE: Export format...
  `;

  const result = await yamlFlatParser(input);
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
    'term.one": {}',
    'term.one: null',
    'term.one: 123',
    '[ { term.one: ok? } ]',
    '[ hello ]',
    'term.one: nested: term',
  ];

  expect.assertions(inputs.length);

  for (const input of inputs) {
    await expect(yamlFlatParser(input)).rejects.toBeDefined();
  }
});

test('should export yaml files', async () => {
  const result = (await yamlFlatExporter(simpleFormatFixture)).toString().split(/\r?\n/).filter(Boolean);
  const expected = loadFixture('simple-flat.yaml').split(/\r?\n/).filter(Boolean);
  expect(result).toEqual(expected);
});
