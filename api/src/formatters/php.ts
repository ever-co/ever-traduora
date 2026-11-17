import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';
import { parse } from 'php-array-parser';
import { jsonNestedParser } from './jsonnested';
import { NestedKeyConflictError } from './nested-key-conflict';

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
    for (let i = 0; i < partsLen - 1; i++) {
      const key = parts[i];
      if (!Object.prototype.hasOwnProperty.call(current, key)) {
        current[key] = Object.create(null);
      }
      if (typeof current[key] === 'string') {
        throw new NestedKeyConflictError('PHP', parts.slice(0, i + 1).join('.'), translation.term);
      }
      current = current[key];
    }

    const leaf = parts[partsLen - 1];
    if (Object.prototype.hasOwnProperty.call(current, leaf) && typeof current[leaf] !== 'string') {
      throw new NestedKeyConflictError('PHP', translation.term, firstSubTerm(translation.term, current[leaf]));
    }
    current[leaf] = translation.translation;
  }

  return '<?php\n\nreturn [' + serialize(root) + '];';
};

// Names one term below "term", whose sub keys are in "node": the array of a key only exists once a term below it was added.
function firstSubTerm(term: string, node): string {
  const [key] = Object.keys(node);
  if (key === undefined) {
    return term;
  }
  const subTerm = `${term}.${key}`;
  return typeof node[key] === 'string' ? subTerm : firstSubTerm(subTerm, node[key]);
}

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
