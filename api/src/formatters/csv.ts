import * as parse from 'csv-parse';
import * as stringify from 'csv-stringify';
import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';

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

const csvInjectionProtector = (str: string) => {
  const riskyChars = ["=", "+", "-", "@", ",", ";", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

  if(!str) return "";

  const firstChar = str.charAt(0);
  const isInjected = riskyChars.includes(firstChar);
  if(!isInjected) return str;

  const sliceStr = str.slice(1);
  return csvInjectionProtector(sliceStr);
}

export const csvExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  
  // clear some characters
  const protectedTerm = csvInjectionProtector(data.translations[0].term);
  const protectedTranslation = csvInjectionProtector(data.translations[0].translation);

  const payload = [{
    term: protectedTerm.replace('0x0d', ''), 
    translation: protectedTranslation.replace('0x0d', '')
  }];

  const rows = await streamAsPromise(
    stringify((payload), {
      header: false,
    }),
  );
  return rows.join('');
};
