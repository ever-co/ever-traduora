import { config } from '../config';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const JSON_MAX_NESTED_LEVELS = 100;

export const jsonNestedParser: Parser = async (data: string) => {
  const parsed = JSON.parse(data);
  const translations: IntermediateTranslation[] = [];

  if (Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('JSON contents must wrapped inside an object');
  }

  const traverse = (obj, level = 0, parentTerm = undefined) => {
    if (level > config.import.maxNestedLevels) {
      throw new Error(`Too many nested levels in JSON content (>${config.import.maxNestedLevels})`);
    }
    for (const key of Object.keys(obj)) {
      const value = obj[key];
      if (typeof value === 'string') {
        translations.push({
          term: parentTerm ? `${parentTerm}.${key}` : key,
          translation: value,
        });
      } else if (typeof value === 'object') {
        traverse(value, level + 1, parentTerm ? `${parentTerm}.${key}` : key);
      } else {
        throw new Error('JSON nested values must be of object or string type');
      }
    }
  };

  traverse(parsed);

  return {
    translations,
  };
};

export const jsonNestedExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const result = {};
  for (const translation of data.translations) {
    const parts = translation.term.split('.');
    const partsLen = parts.length;
    if (partsLen === 1) {
      result[parts[0]] = translation.translation;
    } else if (partsLen > 1) {
      let current = result;
      for (const key of parts.slice(0, partsLen - 1)) {
        if (!current.hasOwnProperty(key)) {
          current[key] = {};
        }
        if (typeof current[key] === 'string') {
          throw new Error(
            `You have a flat key that have both a value and sub keys. This is not allowed on nested JSON. Sub key: ${translation.term}`,
          );
        }
        current = current[key];
      }

      current[parts[partsLen - 1]] = translation.translation;
    }
  }

  return JSON.stringify(result, null, 4);
};
