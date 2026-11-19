// Copyright (c) 2021-2022 Ever Co. LTD
// Modified code from https://github.com/destromas1/csv-injection-protector
// Originally MIT Licensed
// - see https://github.com/destromas1/csv-injection-protector/blob/master/LICENSE
// - original code `Copyright (c) 2019 Shahjada Talukdar`;

import * as parse from 'csv-parse';
import { stringify } from 'csv-stringify';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

const streamAsPromise = stream => {
  const result = [];

  stream.on('data', data => {
    result.push(data);
  });

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  }).then(() => result);
};

export const csvParser: Parser = async (data: string) => {
  const reader = parse(data, {
    trim: true,
    skip_empty_lines: true,
    relax_column_count: true,
    info: true,
  });

  const rows: Array<{ record: string[]; info: { lines: number } }> = await streamAsPromise(reader);

  // Spreadsheet exports commonly pad rows with trailing empty columns, so
  // those are tolerated. Extra columns with content are still rejected, since
  // they signal an unquoted delimiter and dropping them would corrupt the
  // translation (#379).
  const translations = rows.map(({ record, info }) => {
    if (record.length < 2) {
      throw new Error(`Expected a term and a translation column on line ${info.lines}, found ${record.length} column`);
    }
    if (record.slice(2).some(field => field !== '')) {
      throw new Error(`Line ${info.lines} has content after the translation column. Values containing commas must be quoted.`);
    }
    return { term: record[0], translation: record[1] };
  });

  return {
    translations,
  };
};

/**
 * A spreadsheet reads a cell as a formula when it starts with one of these characters (tab and carriage return included).
 * Digits, '/', '\\', ',', ';' and '|' do not start a formula, so they stay: csv-stringify already quotes a value that holds the ',' delimiter.
 * It does not quote a value that holds ';', and a spreadsheet whose list separator is ';' (the default in many European locales)
 * starts a new cell after each ';': so the text right after each ';' is a cell start too, and loses its triggers the same way.
 * Such a spreadsheet also misses the quotes around the translation, as they open after `term,` inside its cell: it starts a new row
 * at each '\n' or '\r' in it, and reads a '"' after a ';' or a line break as the opening quote of a cell (`""=1+1` gives `=1+1`).
 */
const formulaTriggers = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Characters after which a spreadsheet whose list separator is ';' can start a new cell inside a value.
 */
const cellBreaks = [';', '\n', '\r'];

/**
 * CSV Injection – A Guide To Protecting Your CSV Files
 *
 * Removes every formula trigger at the start of the value and right after each ';', '\n' or '\r', not only the first one:
 * `==1+1` would still start with `=`, and `x;=1+1` becomes `x;1+1`. Quotes right after a ';', '\n' or '\r' stay,
 * and the triggers after them go too: `x;"=1+1` becomes `x;"1+1`. All other characters stay.
 *
 * @param str
 * @returns
 */
const csvInjectionProtector = (str: string) => {
  if (!str) return '';

  let result = '';
  // True at the start of the value and of each cell a ';' spreadsheet can start inside it.
  // A removed trigger `continue`s, so the character after it is still at the cell start.
  let atCellStart = true;
  let afterBreak = false;
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    if (atCellStart && formulaTriggers.includes(char)) {
      continue;
    }
    result += char;
    if (cellBreaks.includes(char)) {
      atCellStart = true;
      afterBreak = true;
    } else if (!(afterBreak && atCellStart && char === '"')) {
      atCellStart = false;
      afterBreak = false;
    }
  }
  return result;
};

export const csvExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const clearedTranslations = data.translations.map((trans: IntermediateTranslation) => {
    return {
      term: csvInjectionProtector(trans.term),
      translation: csvInjectionProtector(trans.translation),
    };
  });

  const rows = await streamAsPromise(
    stringify(clearedTranslations, {
      header: false,
      // csv-stringify quotes only values holding ',', '"' or '\n', but a spreadsheet also ends the row at a lone '\r':
      // unquoted, `hello\r=1+1` would start a new row with a live formula
      quoted_match: '\r',
    }),
  );
  return rows.join('');
};
