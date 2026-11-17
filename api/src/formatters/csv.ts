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
    columns: ['term', 'translation'],
  });

  const translations = await streamAsPromise(reader);

  return {
    translations,
  };
};

/**
 * A spreadsheet reads a cell as a formula when it starts with one of these characters (tab and carriage return included).
 * Digits, '/', '\\', ',', ';' and '|' do not start a formula, so they stay: csv-stringify already quotes a value that holds the ',' delimiter.
 * It does not quote a value that holds ';', and a spreadsheet whose list separator is ';' (the default in many European locales)
 * starts a new cell after each ';': so the text right after each ';' is a cell start too, and loses its triggers the same way.
 */
const formulaTriggers = ['=', '+', '-', '@', '\t', '\r'];

/**
 * CSV Injection – A Guide To Protecting Your CSV Files
 *
 * Removes every formula trigger at the start of the value and right after each ';', not only the first one:
 * `==1+1` would still start with `=`, and `x;=1+1` becomes `x;1+1`. All other characters stay.
 *
 * @param str
 * @returns
 */
const csvInjectionProtector = (str: string) => {
  if (!str) return '';

  let result = '';
  let atCellStart = true;
  for (let i = 0; i < str.length; i++) {
    const char = str.charAt(i);
    if (atCellStart && formulaTriggers.includes(char)) {
      continue;
    }
    atCellStart = char === ';';
    result += char;
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
