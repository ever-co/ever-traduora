import { csvExporter, csvParser } from './csv';
import { loadFixture, riskyPayloads, simpleFormatFixture } from './fixtures';

test('should parse csv files', async () => {
  const input = loadFixture('simple.csv');
  const result = await csvParser(input);
  expect(result).toEqual(simpleFormatFixture);
});

test('should fail if file is malformed, invalid or empty', async () => {
  const inputs = [
    'term.one, translation\nterm.two in new line and no second column',
    'term.one',
    'term.one: translation',
    'term.one, translation,',
    'term.one, val1, val2',
  ];

  expect.assertions(inputs.length);

  for (const input of inputs) {
    await expect(csvParser(input)).rejects.toBeDefined();
  }
});

test('should export csv files', async () => {
  const result = await csvExporter(simpleFormatFixture);
  const expected = loadFixture('simple.csv');
  expect(result).toEqual(expected);
});

test('should remove risky characters from risky payloads and export csv files', async () => {
  const result = await csvExporter(riskyPayloads);
  const expected = loadFixture('cleaned.csv');
  expect(result).toEqual(expected);
});
