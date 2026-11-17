import * as properties from 'properties';
import * as tokenizeProperties from 'properties/lib/parse';
import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';
import * as native2ascii from 'node-native2ascii';

// The options properties.parse() prepares from { strict: true, comments: [';', '#'], separators: ['='], sections: false }.
// Only ';' and '#' start a comment and only '=' separates a key from its value (a space still does, as in Java).
const tokenizerOptions = {
  _strict: true,
  _comments: { ';': true, '#': true },
  _separators: { '=': true },
  sections: false,
};

export const propertiesParser: Parser = async (data: string) => {
  // properties.parse() casts each value: 'null' becomes null, 'true' and 'false' booleans, and anything Number() accepts a number,
  // so 0, false and null were saved as '' and 1.10, 007, +33 and 0x1F changed. Its tokenizer hands over the value as written,
  // with \uXXXX and the other escapes already decoded.
  const parsed: Record<string, string> = {};
  const control: { error?: Error } = {};
  tokenizeProperties(
    data,
    tokenizerOptions,
    {
      line: (key: string, value: string) => {
        parsed[key] = value;
      },
    },
    control,
  );
  if (control.error) {
    throw control.error;
  }

  const translations = [];
  for (const term of Object.keys(parsed)) {
    const translation = parsed[term] ?? '';
    translations.push({
      term,
      translation,
    });
  }

  return {
    translations,
  };
};

export const propertiesExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const out = data.translations.reduce((acc, obj) => ({ ...acc, [obj.term]: obj.translation }), {});
  const result = properties.stringify(out);
  return native2ascii(result);
};
