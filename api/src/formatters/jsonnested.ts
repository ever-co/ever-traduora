import { config } from '../config';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';
import { NestedKeyConflictError } from './nested-key-conflict';

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
      for (let i = 0; i < partsLen - 1; i++) {
        const key = parts[i];
        // not current.hasOwnProperty(): a term named "hasOwnProperty" makes that a string
        if (!Object.prototype.hasOwnProperty.call(current, key)) {
          current[key] = {};
        }
        if (typeof current[key] === 'string') {
          throw new NestedKeyConflictError('Nested JSON', parts.slice(0, i + 1).join('.'), translation.term);
        }
        current = current[key];
      }

      current[parts[partsLen - 1]] = translation.translation;
    }
  }

  return JSON.stringify(result, null, 4);
};
