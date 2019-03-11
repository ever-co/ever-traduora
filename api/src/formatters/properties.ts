import * as properties from 'properties';
import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const propertiesParser: Parser = async (data: string) => {
  const parsed = await new Promise((resolve, reject) => {
    properties.parse(
      data,
      {
        strict: true,
        comments: [';', '#'],
        include: false,
        separators: ['='],
        sections: false,
        unicode: true,
      },
      (error, obj) => {
        if (error) return reject(error);
        resolve(obj);
      },
    );
  });

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
  };
};

export const propertiesExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const out = data.translations.reduce((acc, obj) => ({ ...acc, [obj.term]: obj.translation }), {});
  return properties.stringify(out);
};
