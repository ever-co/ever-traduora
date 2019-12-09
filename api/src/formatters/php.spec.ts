import { loadFixture, simpleFormatFixture } from './fixtures';
import { phpExporter, phpParser } from './php';

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
