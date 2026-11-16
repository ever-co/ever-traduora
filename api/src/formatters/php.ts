import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';
import { parse } from 'php-array-parser';
import { jsonNestedParser } from './jsonnested';

export const phpParser: Parser = async (data: string) => {
  let php = data.substr(data.indexOf('['));
  php = php.substr(0, php.lastIndexOf(';') > 0 ? php.lastIndexOf(';') : php.length);
  return jsonNestedParser(JSON.stringify(parse(php)));
};

export const phpExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  // Build the whole nested object first, so that every child of a parent key ends up in the same PHP array.
  // Null-prototype objects keep a term such as "__proto__" an ordinary key.
  const root = Object.create(null);
  for (const translation of data.translations) {
    const parts = translation.term.split('.');
    const partsLen = parts.length;
    let current = root;
    for (const key of parts.slice(0, partsLen - 1)) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
        current[key] = Object.create(null);
      }
      if (typeof current[key] === 'string') {
        throw new Error(
          `You have a flat key that have both a value and sub keys. This is not allowed on nested PHP arrays. Sub key: ${translation.term}`,
        );
      }
      current = current[key];
    }

    const leaf = parts[partsLen - 1];
    if (Object.prototype.hasOwnProperty.call(current, leaf) && typeof current[leaf] !== 'string') {
      throw new Error(
        `You have a flat key that have both a value and sub keys. This is not allowed on nested PHP arrays. Flat key: ${translation.term}`,
      );
    }
    current[leaf] = translation.translation;
  }

  return '<?php\n\nreturn [' + serialize(root) + '];';
};

function serialize(obj): string {
  let result = '';
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (typeof value === 'string') {
      result += "'" + escape(key) + "'=>'" + escape(value) + "',";
    } else {
      result += "'" + escape(key) + "'=>[" + serialize(value) + '],';
    }
  }
  return result;
}

function escape(str: string): string {
  // Escape every "'" and every "\" except the one of "\n" (newline), so that no value can close its PHP string
  return str.replace(/(\\(?!n)|')/g, '\\$1');
}
