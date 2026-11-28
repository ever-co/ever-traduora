import * as xmlJs from 'xml-js';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';
import { xmlTexts } from './xml-text';

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
 * value (all of it, also when it spans several parts: <g> </g><g> </g><x/>), or when it holds a line break (layout of the
 * file, in LF or CRLF files), it is dropped.
 */
function serializeNodes(nodes: xmlJs.Element[]): string {
  const parts = valueParts(nodes, []);
  const isBlankText = (node: xmlJs.Element) => node.type === 'text' && String(node.text).trim() === '';
  let start = 0;
  while (start < parts.length && isBlankText(parts[start])) {
    start++;
  }
  let end = parts.length;
  while (end > start && isBlankText(parts[end - 1])) {
    end--;
  }
  return parts
    .slice(start, end)
    .map(node => {
      if (node.type === 'cdata') {
        return String(node.cdata);
      }
      if (node.type === 'text') {
        const text = String(node.text);
        if (text.trim() === '') {
          return /[\r\n]/.test(text) ? '' : text;
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

  const indexed: { [term: string]: string } = data.translations.reduce((a, b) => ({ ...a, [b.term]: b.translation }), {});

  // The same document as the xliff library wrote, element for element, except that every source and target text is
  // given to xml-js through xmlTexts and escaped by escapeXmlText: xml-js on its own wrote the translation "&amp;" as
  // "&amp;", which reads back as "&"
  const texts = xmlTexts();
  const units = Object.keys(indexed).map(term => {
    const value = indexed[term] || '';
    return makeElement('trans-unit', { id: escapeUnitId(term) }, [
      makeElement('source', undefined, [{ type: 'text', text: texts.text(value) }]),
      makeElement('target', undefined, [{ type: 'text', text: texts.text(value) }]),
    ]);
  });
  const file = makeElement('file', { original: data.iso, datatype: 'plaintext', 'source-language': data.iso, 'target-language': data.iso }, [
    makeElement('body', undefined, units),
  ]);
  const root = makeElement(
    'xliff',
    {
      'xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'xsi:schemaLocation': 'urn:oasis:names:tc:xliff:document:1.2 http://docs.oasis-open.org/xliff/v1.2/os/xliff-core-1.2-strict.xsd',
      xmlns: 'urn:oasis:names:tc:xliff:document:1.2',
      version: '1.2',
    },
    [file],
  );

  const xml = xmlJs.js2xml({ elements: [root] }, { spaces: 2, textFn: texts.textFn });
  return `<?xml version="1.0" encoding="UTF-8" ?>\n${xml}`;
};

function makeElement(name: string, attributes: xmlJs.Attributes | undefined, elements: xmlJs.Element[]): xmlJs.Element {
  return attributes === undefined ? { type: 'element', name, elements } : { type: 'element', name, attributes, elements };
}

/** A trans-unit id escaped as the xliff library escaped it: & " ' < and > become entities, xml-js then writes it as it is */
function escapeUnitId(term: string): string {
  return term.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
