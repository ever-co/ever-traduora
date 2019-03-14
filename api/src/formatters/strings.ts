import { Parser, Exporter, IntermediateTranslationFormat } from "domain/formatters";
import * as strings from 'strings-file';

export const stringsParser: Parser = async (data: string) => {
  const parsed = strings.parse(data, false);
  const translations = [];
  
  for (const term of Object.keys(parsed)) {
    const translation = parsed[term] || '';
    translations.push({
      term,
      translation,
    });
  }
  
  return {
    translations,
  }
};

export const stringsExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const out = data.translations.reduce((acc, obj) => ({ ...acc, [obj.term]: obj.translation }), {});
  return strings.compile(out).replace(/^\s*$(?:\r\n?|\n)/gm,"")
};
