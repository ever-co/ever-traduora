import { createxliff12 } from 'xliff';
import * as xmlJs from 'xml-js';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const xliffParser: (options: { version: string }) => Parser = options => async (data: string) => {
  if (options.version !== '1.2') {
    throw new Error('Only XLIFF 1.2 is supported');
  }

  // Whitespace-only text is read too: a space between two placeholders (<x/> <x/>) is part of the value
  const xml = xmlJs.xml2js(data, { captureSpacesBetweenElements: true }) as xmlJs.Element;
  const root = childElements(xml, 'xliff')[0];
  if (!root) {
    throw new Error('Not an XLIFF file');
  }
  const files = childElements(root, 'file');
  if (files.length === 0) {
    throw new Error('No file element in the XLIFF file');
  }

  // The languages are those of the first file
  const sourceLanguage = attribute(files[0], 'source-language');
  const sourceOrTarget = attribute(files[0], 'target-language') ? 'target' : 'source';
  const result: IntermediateTranslation[] = [];

  for (const file of files) {
    const body = childElements(file, 'body')[0];
    if (!body) {
      throw new Error('No body element in an XLIFF file element');
    }
    collectUnits(body, sourceOrTarget, result);
  }

  return {
    iso: sourceLanguage,
    translations: result,
  };
};

/**
 * Adds the trans-units of a body or a group to the result, including the ones inside groups at any depth. A group's id
 * is optional and is not part of the terms. A unit's id is required: it is the term. A unit without a value on the
 * chosen side (a unit with no <target> in a file with a target language) is skipped, so it does not overwrite a stored
 * translation with an empty one.
 */
function collectUnits(parent: xmlJs.Element, sourceOrTarget: 'source' | 'target', result: IntermediateTranslation[]) {
  for (const child of parent.elements ?? []) {
    if (child.type !== 'element') {
      continue;
    }
    if (child.name === 'group') {
      collectUnits(child, sourceOrTarget, result);
    } else if (child.name === 'trans-unit') {
      const term = attribute(child, 'id');
      if (term === undefined) {
        throw new Error('A trans-unit without an id');
      }
      const value = childElements(child, sourceOrTarget)[0];
      if (!value) {
        continue;
      }
      result.push({
        term,
        translation: serializeNodes(value.elements ?? []),
      });
    }
  }
}

/**
 * The value made of the nodes inside a <source>, a <target> or an inline element. Text and CDATA are kept, except that
 * a text ending in a line break and indentation loses that end. A placeholder (<x>) becomes its equiv-text; <g>, <mrk>
 * and <ph> become the text they contain. Other inline elements and comments are left out. Whitespace-only text between
 * two of these nodes is part of the value; before the first one or after the last one it is dropped.
 */
function serializeNodes(nodes: xmlJs.Element[]): string {
  const content = nodes.filter(node => node.type === 'text' || node.type === 'cdata' || node.type === 'element');
  return content
    .map((node, index) => {
      if (node.type === 'cdata') {
        return String(node.cdata);
      }
      if (node.type === 'text') {
        const text = String(node.text);
        if (text.trim() === '' && (index === 0 || index === content.length - 1)) {
          return '';
        }
        return /\n\s*$/.test(text) ? text.substring(0, text.lastIndexOf('\n')) : text;
      }
      return serializeElement(node);
    })
    .join('');
}

function serializeElement(element: xmlJs.Element): string {
  switch (element.name) {
    case 'x':
      return attribute(element, 'equiv-text') ?? '';
    case 'g':
    case 'mrk':
    case 'ph':
      return serializeNodes(element.elements ?? []);
    default:
      return '';
  }
}

function childElements(parent: xmlJs.Element, name: string): xmlJs.Element[] {
  return (parent.elements ?? []).filter(child => child.type === 'element' && child.name === name);
}

function attribute(element: xmlJs.Element, name: string): string | undefined {
  const value = element.attributes?.[name];
  return value === undefined ? undefined : String(value);
}

export const xliffExporter: (options: { version: string }) => Exporter = options => async (data: IntermediateTranslationFormat) => {
  if (options.version !== '1.2') {
    throw new Error('Only XLIFF 1.2 is supported');
  }

  const indexed = data.translations.reduce((a, b) => ({ ...a, [b.term]: b.translation }), {});

  const xml = await new Promise((resolve, reject) => {
    // source, target, sourceKeys, targetKeys, namespace
    return createxliff12(data.iso, data.iso, indexed, indexed, data.iso, (err, res) => {
      if (err != null) {
        return reject(err);
      }
      return resolve(res);
    });
  });

  return `<?xml version="1.0" encoding="UTF-8" ?>\n${xml}`;
};
