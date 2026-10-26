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
 * CSV Injection – A Guide To Protecting Your CSV Files
 *
 * @param str
 * @returns
 */
const csvInjectionProtector = (str: string) => {
  const riskyChars = ['=', '+', '-', '@', ',', ';', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0x0d', '/C', '.exe', '\\', '/', '.dll', '|'];
  if (!str) return '';

  /**
   * Check first character of string
   */
  if (riskyChars.includes(str.charAt(0))) {
    return str.replace(str.charAt(0), '');
  }
  return str;
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
