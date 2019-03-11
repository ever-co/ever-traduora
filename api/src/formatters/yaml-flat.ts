import * as yaml from 'js-yaml';
import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const yamlFlatParser: Parser = async (data: string) => {
  const parsed = yaml.safeLoad(data);
  const translations = [];
  if (Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('YAML contents are not of key:value format');
  }
  for (const term of Object.keys(parsed)) {
    const translation = parsed[term];
    if (typeof translation !== 'string' || typeof term !== 'string') {
      throw new Error('YAML contents are not of key:value format');
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

export const yamlFlatExporter: Exporter = async (data: IntermediateTranslationFormat) =>
  yaml.safeDump(data.translations.reduce((acc, x) => ({ ...acc, [x.term]: x.translation }), {}));
