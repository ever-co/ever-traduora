import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

// Application Resource Bundle (.arb), the localisation file format of Flutter / Dart apps.
// It is a flat JSON object of key: message. Keys that start with "@" are metadata and are not messages:
// "@@locale" names the locale of the file and "@<key>" holds the description / placeholders of a message.

const isMetadataKey = (key: string) => key.startsWith('@');

export const arbParser: Parser = async (data: string) => {
  const parsed = JSON.parse(data);
  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('ARB contents are not of key:value format');
  }

  const translations: IntermediateTranslation[] = [];
  for (const term of Object.keys(parsed)) {
    if (isMetadataKey(term)) {
      continue;
    }
    const translation = parsed[term];
    if (typeof translation !== 'string') {
      throw new Error('ARB contents are not of key:value format');
    }
    translations.push({ term, translation });
  }

  return { translations };
};

export const arbExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const out: { [key: string]: string } = {};

  if (data.iso) {
    out['@@locale'] = data.iso;
  }

  for (const { term, translation } of data.translations) {
    // A key starting with "@" is reserved for metadata: written out, it would be dropped on re-import and a term
    // named "@@locale" would overwrite the locale of the file. Such terms are therefore left out of the export.
    if (isMetadataKey(term)) {
      continue;
    }
    // defineProperty so that a term named "__proto__" stays an ordinary key
    Object.defineProperty(out, term, { value: translation, enumerable: true, writable: true, configurable: true });
  }

  return JSON.stringify(out, null, 2);
};
