import { loadFixture, simpleFormatFixture } from './fixtures';
import { phpExporter, phpParser } from './php';
import { IntermediateTranslationFormat } from '../domain/formatters';
import { NestedKeyConflictError } from './nested-key-conflict';

test('should parse php files', async () => {
  const input = `[
      "term two" => "hello there, all good?",
      "term.three.is..very.nested" => "Export format...",
      "term" => [
        "one" => "Current Plan: {{ project.plan.name }}",
        "three" => [
          "is" => [
            "" => [
              "very" => [
                "nested too" => "Another export format..."
              ]
            ]
          ]
        ]
      ]
    ]`;
  const result = await phpParser(input);
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
    '[ "term.one" => "translation" ',
    '[ "term.one" => ]',
    '[ "term.one" => 123 }',
    '[ "hello" ]',
    '[ "term.one" => [ "nested" => 123 ] ]',
  ];

  expect.assertions(inputs.length);

  for (const input of inputs) {
    await expect(phpParser(input)).rejects.toBeDefined();
  }
});

test('should export php files', async () => {
  const result = await phpExporter(simpleFormatFixture);
  const expected = loadFixture('simple.php');
  expect(result).toEqual(expected);
});

test('should espace on export of php files', async () => {
  const input: IntermediateTranslationFormat = {
    translations: [
      {
        term: 'this term has "double quotes"',
        translation: `this translation also has "double quotes"`,
      },
    ],
  };
  const result = await phpExporter(input);
  const expected = loadFixture('double-quotes-out.php');
  expect(result).toEqual(expected);
});

test('should espace on import of php files', async () => {
  const input = loadFixture('double-quotes-in.php');
  const imported = await phpParser(input);
  expect(imported).toEqual({
    translations: [
      {
        term: 'this term has "double quotes"',
        translation: `this translation also has "double quotes"`,
      },
    ],
  });
  const result = await phpExporter(imported);
  const expected = loadFixture('double-quotes-out.php');
  expect(result).toEqual(expected);
});

test('should espace on import of php files', async () => {
  const input = loadFixture('double-and-single-quotes.php');
  const imported = await phpParser(input);
  const output = await phpExporter(imported);
  expect(output).toEqual(input);
});

test('should not let a backslash before a quote close the string on export of php files', async () => {
  const input: IntermediateTranslationFormat = {
    translations: [
      {
        term: 'zzz',
        translation: `\\'.system("id")];#`,
      },
    ],
  };
  const output = await phpExporter(input);
  expect(output).toEqual(`<?php\n\nreturn ['zzz'=>'\\\\\\'.system("id")];#',];`);
  expect(await phpParser(output as string)).toEqual(input);
});

test('should keep sibling keys under their parent on export of php files', async () => {
  const input: IntermediateTranslationFormat = {
    translations: [
      {
        term: 'app.desc',
        translation: 'D',
      },
      {
        term: 'app.title',
        translation: 'T',
      },
    ],
  };
  const output = await phpExporter(input);
  expect(output).toEqual(`<?php\n\nreturn ['app'=>['desc'=>'D','title'=>'T',],];`);
  expect(await phpParser(output as string)).toEqual(input);

  const deeper: IntermediateTranslationFormat = {
    translations: [
      { term: 'a.b.c', translation: '1' },
      { term: 'a.b.d', translation: '2' },
      { term: 'a.e', translation: '3' },
      { term: 'f', translation: '4' },
    ],
  };
  expect(await phpParser((await phpExporter(deeper)) as string)).toEqual(deeper);
});

test('should fail on export of php files when a key is both a value and a parent', async () => {
  const valueFirst: IntermediateTranslationFormat = {
    translations: [
      { term: 'app', translation: 'A' },
      { term: 'app.title', translation: 'T' },
    ],
  };
  const childFirst: IntermediateTranslationFormat = {
    translations: [
      { term: 'app.title', translation: 'T' },
      { term: 'app', translation: 'A' },
    ],
  };
  for (const input of [valueFirst, childFirst]) {
    await expect(phpExporter(input)).rejects.toBeInstanceOf(NestedKeyConflictError);
    await expect(phpExporter(input)).rejects.toThrow('PHP cannot hold the term "app" together with "app.title"');
    await expect(phpExporter(input)).rejects.toThrow('both a value and sub keys');
  }

  // the conflict is deeper than the first level, and the term holding the value comes last
  const deeperChildFirst: IntermediateTranslationFormat = {
    translations: [
      { term: 'a.b.c.d', translation: '1' },
      { term: 'a.b', translation: '2' },
    ],
  };
  await expect(phpExporter(deeperChildFirst)).rejects.toBeInstanceOf(NestedKeyConflictError);
  await expect(phpExporter(deeperChildFirst)).rejects.toThrow('PHP cannot hold the term "a.b" together with "a.b.c.d"');
});
