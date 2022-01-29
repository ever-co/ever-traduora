// Copyright (c) 2021-2022 Ever Co. LTD
// Modified code from https://github.com/destromas1/csv-injection-protector
// Originally MIT Licensed
// - see https://github.com/destromas1/csv-injection-protector/blob/master/LICENSE
// - original code `Copyright (c) 2019 Shahjada Talukdar`;

import * as parse from 'csv-parse';
import * as stringify from 'csv-stringify';
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
 * CSV Injection – A Guide To Protecting Your CSV Files
 * 
 * @param str 
 * @returns 
 */
const csvInjectionProtector = (str: string) => {
	const riskyChars = ['=', '+', '-', '@', ',', ';', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0x0d', '/C', '.exe', '\\', '/', '.dll'];
	if (!str) return '';

	/**
	 * Check first character of string
	 */
	if (riskyChars.includes(str.charAt(0))) {
		return (str = str.replace(str.charAt(0), ''));
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
