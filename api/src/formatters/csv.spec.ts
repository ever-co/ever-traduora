import { csvExporter, csvParser } from './csv';
import { loadFixture, riskyPayloads, simpleFormatFixture } from './fixtures';

test('should parse csv files', async () => {
  const input = loadFixture('simple.csv');
  const result = await csvParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should tolerate trailing empty columns from spreadsheet exports', async () => {
  const input = 'term.one,translation one,,,\nterm.two,translation two,';
  const result = await csvParser(input);
  expect(result).toEqual({
    translations: [
      { term: 'term.one', translation: 'translation one' },
      { term: 'term.two', translation: 'translation two' },
    ],
  });
});

test('should fail if file is malformed, invalid or empty', async () => {
  const inputs = [
    'term.one, translation\nterm.two in new line and no second column',
    'term.one',
    'term.one: translation',
    'term.one, val1, val2',
    'term.one, translation, extra data',
  ];

  expect.assertions(inputs.length);

  for (const input of inputs) {
    await expect(csvParser(input)).rejects.toBeDefined();
  }
});

test('should explain that values containing commas must be quoted', async () => {
  await expect(csvParser('term.one,an unquoted, comma')).rejects.toThrow(
    'Line 1 has content after the translation column. Values containing commas must be quoted.',
  );
});

test('should report source line numbers even when blank lines are skipped', async () => {
  await expect(csvParser('term.one,ok\n\nterm.two,an unquoted, comma')).rejects.toThrow(
    'Line 3 has content after the translation column. Values containing commas must be quoted.',
  );
});

test('should export csv files', async () => {
  const result = (await csvExporter(simpleFormatFixture)).toString().split(/\r?\n/).filter(Boolean);
  const expected = loadFixture('simple.csv').split(/\r?\n/);
  expect(result).toEqual(expected);
});

test('should remove risky characters from risky payloads and export csv files', async () => {
  const result = (await csvExporter(riskyPayloads)).toString().split(/\r?\n/).filter(Boolean);
  const expected = loadFixture('cleaned.csv').toString().split(/\r?\n/).filter(Boolean);
  expect(result).toEqual(expected);
});
