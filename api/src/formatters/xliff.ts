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
 * The value made of the nodes inside a <source> or a <target>. Text and CDATA are kept, except that a text ending in a
 * line break and indentation loses that end. A placeholder (<x>) becomes its equiv-text; <g>, <mrk> and <ph> become the
 * text they contain. Other inline elements and comments are left out. Whitespace-only text on one line between two parts
 * of the value is part of it, also at the edge of a <g>, <mrk> or <ph> (<g><x/> </g><x/>). At the start or end of the
 * value, or when it holds a line break (layout of the file, in LF or CRLF files), it is dropped.
 */
function serializeNodes(nodes: xmlJs.Element[]): string {
  const parts = valueParts(nodes, []);
  return parts
    .map((node, index) => {
      if (node.type === 'cdata') {
        return String(node.cdata);
      }
      if (node.type === 'text') {
        const text = String(node.text);
        if (text.trim() === '') {
          return index === 0 || index === parts.length - 1 || /[\r\n]/.test(text) ? '' : text;
        }
        return /\n\s*$/.test(text) ? text.substring(0, text.lastIndexOf('\n')) : text;
      }
      return attribute(node, 'equiv-text') ?? '';
    })
    .join('');
}

/**
 * The text, CDATA and placeholder (<x>) nodes of a value in order, with the nodes inside <g>, <mrk> and <ph> in their
 * place. Comments and other inline elements are left out.
 */
function valueParts(nodes: xmlJs.Element[], parts: xmlJs.Element[]): xmlJs.Element[] {
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'cdata' || (node.type === 'element' && node.name === 'x')) {
      parts.push(node);
    } else if (node.type === 'element' && (node.name === 'g' || node.name === 'mrk' || node.name === 'ph')) {
      valueParts(node.elements ?? [], parts);
    }
  }
  return parts;
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
