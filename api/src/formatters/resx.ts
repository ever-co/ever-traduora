/* tslint:disable */

import * as xmlJs from 'xml-js';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';
import { escapeXmlAttribute } from './xml-attribute';

export const resXParser: Parser = async (data: string) => {
  // Keep spaces-only text: Traduora writes xml:space="preserve", and .NET keeps such a value as it is
  const xml = xmlJs.xml2js(data, { captureSpacesBetweenElements: true });

  const result: IntermediateTranslation[] = [];

  for (const element of xml.elements) {
    if (element.type === 'element' && element.name === 'root') {
      for (const resource of element.elements) {
        if (resource.type === 'element' && resource.name === 'data' && resource.attributes && resource.attributes.name) {
          const term = resource.attributes.name;
          if (typeof term === 'string') {
            const valueElem = (resource.elements || []).find(child => child.type === 'element' && child.name === 'value');
            if (valueElem) {
              // Right now only string resources are supported. RESX text has no backslash escapes, and xml-js already decodes XML entities.
              const translation = (valueElem.elements || [])
                .map(child => (child.type === 'text' ? child.text : child.type === 'cdata' ? child.cdata : ''))
                .join('');
              result.push({
                term: term,
                translation: translation,
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

export const resXExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const strings = data.translations.map(translation => ({
    _attributes: { name: escapeXmlAttribute(translation.term), 'xml:space': 'preserve' },
    value: translation.translation,
  }));
  const xml = xmlJs.js2xml(
    {
      _declaration: { _attributes: { version: '1.0', encoding: 'utf-8' } },
      root: {
        'xsd:schema': getXsdSchema(),
        resheader: [
          {
            _attributes: { name: 'resmimetype' },
            value: 'text/microsoft-resx',
          },
          {
            _attributes: { name: 'version' },
            value: '2.0',
          },
          {
            _attributes: { name: 'reader' },
            value: 'System.Resources.ResXResourceReader, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089',
          },
          {
            _attributes: { name: 'writer' },
            value: 'System.Resources.ResXResourceWriter, System.Windows.Forms, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089',
          },
        ],
        data: strings,
      },
    },
    { compact: true, spaces: 2 },
  );
  return xml;
};

function getXsdSchema(): any {
  return {
    _attributes: { id: 'root', xmlns: '', 'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema', 'xmlns:msdata': 'urn:schemas-microsoft-com:xml-msdata' },
    'xsd:import': { _attributes: { namespace: 'http://www.w3.org/XML/1998/namespace' } },
    'xsd:element': {
      _attributes: { name: 'root', 'msdata:IsDataSet': 'true' },
      'xsd:complexType': {
        'xsd:choice': {
          _attributes: { maxOccurs: 'unbounded' },
          'xsd:element': [
            {
              _attributes: { name: 'metadata' },
              'xsd:complexType': {
                'xsd:sequence': { 'xsd:element': { _attributes: { name: 'value', type: 'xsd:string', minOccurs: '0' } } },
                'xsd:attribute': [
                  { _attributes: { name: 'name', use: 'required', type: 'xsd:string' } },
                  { _attributes: { name: 'type', type: 'xsd:string' } },
                  { _attributes: { name: 'mimetype', type: 'xsd:string' } },
                  { _attributes: { ref: 'xml:space' } },
                ],
              },
            },
            {
              _attributes: { name: 'assembly' },
              'xsd:complexType': {
                'xsd:attribute': [{ _attributes: { name: 'alias', type: 'xsd:string' } }, { _attributes: { name: 'name', type: 'xsd:string' } }],
              },
            },
            {
              _attributes: { name: 'data' },
              'xsd:complexType': {
                'xsd:sequence': {
                  'xsd:element': [
                    { _attributes: { name: 'value', type: 'xsd:string', minOccurs: '0', 'msdata:Ordinal': '1' } },
                    { _attributes: { name: 'comment', type: 'xsd:string', minOccurs: '0', 'msdata:Ordinal': '2' } },
                  ],
                },
                'xsd:attribute': [
                  { _attributes: { name: 'name', type: 'xsd:string', use: 'required', 'msdata:Ordinal': '1' } },
                  { _attributes: { name: 'type', type: 'xsd:string', 'msdata:Ordinal': '3' } },
                  { _attributes: { name: 'mimetype', type: 'xsd:string', 'msdata:Ordinal': '4' } },
                  { _attributes: { ref: 'xml:space' } },
                ],
              },
            },
            {
              _attributes: { name: 'resheader' },
              'xsd:complexType': {
                'xsd:sequence': { 'xsd:element': { _attributes: { name: 'value', type: 'xsd:string', minOccurs: '0', 'msdata:Ordinal': '1' } } },
                'xsd:attribute': { _attributes: { name: 'name', type: 'xsd:string', use: 'required' } },
              },
            },
          ],
        },
      },
    },
  };
}
