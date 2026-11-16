import * as xmlJs from 'xml-js';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const androidXmlParser: Parser = async (data: string) => {
  const xml = xmlJs.xml2js(data);

  const result: IntermediateTranslation[] = [];

  for (const element of xml.elements) {
    if (element.type === 'element' && element.name === 'resources') {
      for (const resource of element.elements) {
        // Right now only string resources are supported: plurals, string arrays and other types are skipped
        if (resource.type === 'element' && resource.name === 'string' && resource.attributes && resource.attributes.name) {
          const term = resource.attributes.name;
          if (typeof term === 'string') {
            if (resource.elements && resource.elements.length > 0) {
              result.push({
                term: term,
                translation: stringContent(resource.elements),
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

/**
 * The value of a string resource, built from all of its child nodes in order: text and CDATA are read as text, an
 * xliff:g element is replaced by its content as the Android build does, and other inline tags (b, i, u...) are kept as
 * markup. Only the text parts are unescaped.
 */
function stringContent(nodes: xmlJs.Element[]): string {
  return nodes
    .map(node => {
      switch (node.type) {
        case 'text':
          return unescape(String(node.text));
        case 'cdata':
          return unescape(node.cdata);
        case 'element':
          return node.name === 'xliff:g' ? stringContent(node.elements || []) : xmlJs.js2xml({ elements: [node] });
        default:
          return '';
      }
    })
    .join('');
}

function unescape(str: string): string {
  return str.replace(/(?<!\\)"/g, '').replace(/\\([\'@"\?])/g, '$1');
}

function escape(str: string): string {
  return str.replace(/([\'@"\?])/g, '\\$1');
}
