import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';
import { parse } from 'php-array-parser';
import { jsonNestedParser } from './jsonnested';

export const phpParser: Parser = async (data: string) => {
  let php = data.substr(data.indexOf('['));
  php = php.substr(0, php.lastIndexOf(';') > 0 ? php.lastIndexOf(';') : php.length);
  return jsonNestedParser(JSON.stringify(parse(php)));
};

export const phpExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  let result = '<?php\n\nreturn [';
  const jsonObject = {};
  for (const translation of data.translations) {
    const parts = translation.term.split('.');
    const partsLen = parts.length;
    if (partsLen === 1) {
      jsonObject[parts[0]] = translation.translation;
      result += "'" + escape(parts[0]) + "'=>'" + escape(translation.translation) + "',";
    } else if (partsLen > 1) {
      let current = jsonObject;
      let depth = 0;
      for (const key of parts.slice(0, partsLen - 1)) {
        if (!current.hasOwnProperty(key)) {
          current[key] = {};
          result += "'" + escape(key) + "'=>[";
          depth++;
        }
        current = current[key];
      }

      current[parts[partsLen - 1]] = translation.translation;
      result += "'" + escape(parts[partsLen - 1]) + "'=>'" + escape(translation.translation) + "',";

      for (let i = 0; i < depth; i++) {
        result += '],';
      }
    }
  }
  result += '];';

  return result;
};

function escape(str: string): string {
  // Escape any "\" or "'" except "\n" (newline)
  return str.replace(/((\\(?![n\']))|\')/g, '\\$1');
}
