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
 */
const formulaTriggers = ['=', '+', '-', '@', '\t', '\r'];

/**
 * CSV Injection – A Guide To Protecting Your CSV Files
 *
 * Removes every leading formula trigger, not only the first one: `==1+1` would still start with `=`.
 *
 * @param str
 * @returns
 */
const csvInjectionProtector = (str: string) => {
  if (!str) return '';

  let start = 0;
  while (start < str.length && formulaTriggers.includes(str.charAt(start))) {
    start++;
  }
  return str.slice(start);
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
    }),
  );
  return rows.join('');
};
