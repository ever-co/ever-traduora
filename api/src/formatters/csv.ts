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

export const csvExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const rows = await streamAsPromise(
    stringify(data.translations, {
      header: false,
    }),
  );
  return rows.join('');
};
