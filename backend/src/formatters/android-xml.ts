import * as xmlJs from 'xml-js';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const androidXmlParser: Parser = async (data: string) => {
  const xml = xmlJs.xml2js(data);

  const result: IntermediateTranslation[] = [];

  for (const element of xml.elements) {
    if (element.type === 'element' && element.name === 'resources') {
      for (const resource of element.elements) {
        if (resource.type === 'element' && resource.attributes && resource.attributes.name) {
          const term = resource.attributes.name;
          if (typeof term === 'string') {
            if (resource.elements && resource.elements.length > 0) {
              const translationElem = resource.elements[0];
              // Right now only string resources are supported
              const translation = translationElem.type === 'text' ? translationElem.text : '';
              result.push({
                term: term,
                translation: unescape(translation),
              });
            }
          }
        }
      }
    }
  }

  return {
    translations: result,
  };
};

export const androidXmlExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const strings = data.translations.map(translation => ({
    _attributes: { name: translation.term },
    _text: escape(translation.translation),
  }));
  return xmlJs.js2xml(
    {
      _declaration: { _attributes: { version: '1.0', encoding: 'utf-8' } },
      resources: {
        string: strings,
      },
    },
    { compact: true },
  );
};

function unescape(str: string): string {
  return str.replace(/(?<!\\)"/g, '').replace(/\\([\'@"\?])/g, '$1');
}

function escape(str: string): string {
  return str.replace(/([\'@"\?])/g, '\\$1');
}
