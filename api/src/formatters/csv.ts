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

  const riskyChars = ["=", "+", "-", "@", ",", ";", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0x0d", "/C", ".exe", "\\", "/", ".dll"];
  if(!str) return "";

  riskyChars.map(risk => {
    if(str.includes(risk)){
      str = str.replace(risk, "");
    }
  });

  return str;
}

export const csvExporter: Exporter = async (data: IntermediateTranslationFormat) => {

  const clearedTranslations = [];
  data.translations.map(trans => {
    const protectedTranslation = {
      term: csvInjectionProtector(trans.term),
      translation: csvInjectionProtector(trans.translation)
    }
    clearedTranslations.push(protectedTranslation);
  });

  console.log('clearedTranslations >>> ', clearedTranslations);
  
  const rows = await streamAsPromise(
    stringify((clearedTranslations), {
      header: false,
    }),
  );
  return rows.join('');
};
