import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const jsonFlatParser: Parser = async (data: string) => {
  const parsed = JSON.parse(data);
  const translations = [];
  if (Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('JSON contents are not of key:value format');
  }
  for (const term of Object.keys(parsed)) {
    const translation = parsed[term];
    if (typeof translation !== 'string' || typeof term !== 'string') {
      throw new Error('JSON contents are not of key:value format');
    }
    translations.push({
      term,
      translation,
    });
  }
  return {
    translations,
  };
};

export const jsonFlatExporter: Exporter = async (data: IntermediateTranslationFormat) =>
  JSON.stringify(
    data.translations.reduce((acc, x) => ({ ...acc, [x.term]: x.translation }), {}),
    null,
    4,
  );
