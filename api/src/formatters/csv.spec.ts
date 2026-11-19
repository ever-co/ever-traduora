import * as parse from 'csv-parse';
import { IntermediateTranslationFormat } from '../domain/formatters';
import { csvExporter, csvParser } from './csv';
import { loadFixture, riskyPayloads, simpleFormatFixture } from './fixtures';

// Reads the cells without trimming them, so a leading tab or carriage return stays visible
const parseRows = (csv: string): Promise<string[][]> =>
  new Promise((resolve, reject) => parse(csv, { skip_empty_lines: true }, (err, rows) => (err ? reject(err) : resolve(rows))));

// Reads the cells the way a spreadsheet whose list separator is ';' does: a new cell starts after every ';'.
// `relax` keeps a quote inside a cell as text (csv-parse 4 name of the `relax_quotes` option)
const parseSemicolonRows = (csv: string): Promise<string[][]> =>
  new Promise((resolve, reject) =>
    parse(csv, { delimiter: ';', relax: true, relax_column_count: true, skip_empty_lines: true }, (err, rows) => (err ? reject(err) : resolve(rows))),
  );

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

test('should remove every leading formula trigger, not only the first one', async () => {
  const doubledTriggers: IntermediateTranslationFormat = {
    translations: [
      { term: '==1+1', translation: '++1+1' },
      { term: `+=cmd|' /C calc'!A0`, translation: `-=cmd|' /C calc'!A0` },
      { term: '@-x', translation: '-@x' },
      { term: '\t=1+1', translation: '\r=1+1' },
    ],
  };

  const rows = await parseRows((await csvExporter(doubledTriggers)).toString());
  const cells: string[] = [].concat(...rows);

  expect(cells).toHaveLength(8);
  for (const cell of cells) {
    expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  }
  expect(rows).toEqual([
    ['1+1', '1+1'],
    [`cmd|' /C calc'!A0`, `cmd|' /C calc'!A0`],
    ['x', 'x'],
    ['1+1', '1+1'],
  ]);
});

test('should export values that start with a digit, a slash, a backslash, a comma, a semicolon or a pipe unchanged', async () => {
  const plainValues: IntermediateTranslationFormat = {
    translations: [
      { term: '404.title', translation: '5 minutes' },
      { term: '/help', translation: '/help' },
      { term: '\\\\server\\share', translation: ', and more' },
      { term: ';comment', translation: '| separated' },
    ],
  };

  const exported = (await csvExporter(plainValues)).toString();

  expect(await parseRows(exported)).toEqual(plainValues.translations.map(({ term, translation }) => [term, translation]));
  expect((await csvParser(exported)).translations).toEqual(plainValues.translations);
});

test('should remove the formula triggers after each semicolon, so a spreadsheet that splits on semicolons gets no formula', async () => {
  const values = ['x;=1+1', 'a;@SUM(1+1)', 'b;;-1', 'c;+=1'];
  const semicolonPayloads: IntermediateTranslationFormat = {
    translations: values.map(value => ({ term: value, translation: value })),
  };

  const exported = (await csvExporter(semicolonPayloads)).toString();
  const rows = await parseSemicolonRows(exported);
  const cells: string[] = [].concat(...rows);

  expect(rows).toHaveLength(values.length);
  for (const cell of cells) {
    expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  }
  expect(await parseRows(exported)).toEqual([
    ['x;1+1', 'x;1+1'],
    ['a;SUM(1+1)', 'a;SUM(1+1)'],
    ['b;;1', 'b;;1'],
    ['c;1', 'c;1'],
  ]);
});

test('should export a value with a space between the semicolon and a formula trigger unchanged', async () => {
  const spaced: IntermediateTranslationFormat = {
    translations: [{ term: 'a; =b', translation: 'a; =b' }],
  };

  const exported = (await csvExporter(spaced)).toString();

  expect(exported).toBe('a; =b,a; =b\n');
  expect(await parseRows(exported)).toEqual([['a; =b', 'a; =b']]);
});

test('should quote a value with a carriage return inside, so a spreadsheet cannot start a new row with a formula there', async () => {
  const embedded: IntermediateTranslationFormat = {
    translations: [
      { term: 'greeting', translation: `hello\r=cmd|' /C calc'!A0` },
      { term: `a\r@SUM(1+1)`, translation: 'b' },
    ],
  };

  const exported = (await csvExporter(embedded)).toString();

  // Outside quotes, a spreadsheet ends the row at every '\r' or '\n', so only the two real row ends may be left.
  // The triggers after the '\r' go too: a spreadsheet that splits on semicolons does not see the quotes around the translation
  expect(exported).toBe(`greeting,"hello\rcmd|' /C calc'!A0"\n"a\rSUM(1+1)",b\n`);
  expect(await parseRows(exported)).toEqual([
    ['greeting', `hello\rcmd|' /C calc'!A0`],
    ['a\rSUM(1+1)', 'b'],
  ]);
});

test('should remove the formula triggers after a line break, and after quotes that follow a semicolon or a line break', async () => {
  // In a spreadsheet that splits on semicolons, the quotes around the translation open inside the `term,` cell, so they do not hold
  // its line breaks: each one starts a new row. A '"' right after a ';' or a line break opens a quoted cell there: `""=1+1` reads as `=1+1`
  const values = ['a\n=1+1;', `hello\r=cmd|' /C calc'!A0;`, 'b\r\n@SUM(1+1);', 'c;"=1+1;', 'd\n""-1;'];
  const payloads: IntermediateTranslationFormat = {
    translations: values.map(value => ({ term: 'term', translation: value })),
  };

  const exported = (await csvExporter(payloads)).toString();
  // Every place such a spreadsheet can start a cell, whatever the quotes around it
  const cells = exported.split(/[;\r\n]/).map(cell => cell.replace(/^"+/, ''));

  for (const cell of cells) {
    expect(cell).not.toMatch(/^[=+\-@\t]/);
  }
  expect((await parseRows(exported)).map(([, translation]) => translation)).toEqual([
    'a\n1+1;',
    `hello\rcmd|' /C calc'!A0;`,
    'b\r\nSUM(1+1);',
    'c;"1+1;',
    'd\n""1;',
  ]);
});

test('should export quotes and line breaks that are not followed by a formula trigger unchanged', async () => {
  const plainValues: IntermediateTranslationFormat = {
    translations: [
      { term: '"=" sign', translation: '"+" button' },
      { term: 'lines', translation: 'one\ntwo\r\nthree' },
      { term: 'quoted', translation: 'say;"hi"' },
    ],
  };

  const exported = (await csvExporter(plainValues)).toString();

  expect(await parseRows(exported)).toEqual(plainValues.translations.map(({ term, translation }) => [term, translation]));
});
