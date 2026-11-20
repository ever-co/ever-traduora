import * as xmlJs from 'xml-js';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const androidXmlParser: Parser = async (data: string) => {
  // A space between two inline tags (<b>a</b> <i>b</i>) is part of the value, so whitespace-only text is read too
  const xml = xmlJs.xml2js(data, { captureSpacesBetweenElements: true });

  const result: IntermediateTranslation[] = [];

  for (const element of xml.elements) {
    if (element.type === 'element' && element.name === 'resources') {
      for (const resource of element.elements) {
        // Right now only string resources are supported: plurals, string arrays and other types are skipped
        if (resource.type === 'element' && isStringResource(resource) && resource.attributes && resource.attributes.name) {
          const term = resource.attributes.name;
          if (typeof term === 'string') {
            const content = normalize(resource.elements || []);
            if (content.length > 0) {
              result.push({
                term: term,
                translation: stringContent(content),
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

/** A <string>, or an <item type="string">, which Android reads the same way */
function isStringResource(resource: xmlJs.Element): boolean {
  return resource.name === 'string' || (resource.name === 'item' && !!resource.attributes && resource.attributes.type === 'string');
}

/**
 * The child nodes of a string resource, in order, as they make up its value: text and CDATA become unescaped text, an
 * xliff:g element is replaced by its content as the Android build does, other inline tags (b, i, u...) are kept with
 * their content read the same way, and comments are dropped. Whitespace-only text directly inside the resource, before
 * its first node or after its last one, is layout and is dropped; anywhere else, including inside a nested tag, it is
 * part of the value.
 */
function normalize(nodes: xmlJs.Element[], nested = false): xmlJs.Element[] {
  const content = nodes.filter(node => node.type === 'text' || node.type === 'cdata' || node.type === 'element');
  const result: xmlJs.Element[] = [];
  content.forEach((node, index) => {
    if (node.type === 'element') {
      if (node.name === 'xliff:g') {
        result.push(...normalize(node.elements || [], true));
      } else {
        result.push({ ...node, elements: node.elements && normalize(node.elements, true) });
      }
    } else if (node.type === 'cdata') {
      result.push({ type: 'text', text: unescape(node.cdata) });
    } else if (nested || (index > 0 && index < content.length - 1) || String(node.text).trim() !== '') {
      result.push({ type: 'text', text: unescape(String(node.text)) });
    }
  });
  return result;
}

/** The value made of normalized nodes: text as it is, inline tags written back as markup */
function stringContent(nodes: xmlJs.Element[]): string {
  return nodes.map(node => (node.type === 'text' ? String(node.text) : xmlJs.js2xml({ elements: [node] }))).join('');
}

function unescape(str: string): string {
  return str.replace(/(?<!\\)"/g, '').replace(/\\([\'@"\?])/g, '$1');
}

function escape(str: string): string {
  return str.replace(/([\'@"\?])/g, '\\$1');
}
