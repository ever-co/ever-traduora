import { createxliff12, xliff12ToJs } from 'xliff';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const xliffParser: (options: { version: string }) => Parser = options => async (data: string) => {
  const xml = await parseFromVersion(options.version, data);

  const sourceOrTarget = xml.targetLanguage ? 'target' : 'source';
  const result: IntermediateTranslation[] = [];

  const resources = xml.resources;
  for (const resourceName of Object.keys(resources)) {
    collectUnits(resources[resourceName], sourceOrTarget, result);
  }

  return {
    iso: xml.sourceLanguage,
    translations: result,
  };
};

/**
 * Adds the trans-units to the result, including the ones inside (nested) groups. A unit without a value on the chosen
 * side (a unit with no <target> in a file with a target language) is skipped, so it does not overwrite a stored
 * translation with an empty one.
 */
function collectUnits(units: any, sourceOrTarget: 'source' | 'target', result: IntermediateTranslation[]) {
  for (const unitId of Object.keys(units)) {
    const unit = units[unitId];
    if (unit.groupUnits) {
      collectUnits(unit.groupUnits, sourceOrTarget, result);
      continue;
    }

    const value = unit[sourceOrTarget];
    if (value === undefined || value === null) {
      continue;
    }

    result.push({
      term: unitId,
      translation: serializeValue(value),
    });
  }
}

/**
 * A value is a string, a single inline element or an array of strings and inline elements.
 */
function serializeValue(value: any): string {
  if (typeof value === 'string') {
    return value;
  }
  const items = Array.isArray(value) ? value : [value];
  return items.map(serializeElement).join('');
}

async function parseFromVersion(version: string, data: string) {
  if (version !== '1.2') {
    throw new Error('Only XLIFF 1.2 is supported');
  }

  const xml = (await new Promise((resolve, reject) =>
    xliff12ToJs(data, (err, res) => {
      if (err != null) {
        return reject(err);
      }
      return resolve(res);
    }),
  )) as any;

  return xml;
}

/**
 * A placeholder (<x>) becomes its equiv-text; <g>, <mrk> and <ph> become the text they contain. Other inline elements
 * are left out.
 */
function serializeElement(element: any): string {
  if (typeof element !== 'object' || element === null) {
    return element;
  }
  if (element.Standalone) {
    return element.Standalone['equiv-text'] ?? '';
  }
  const span = element.GenericSpan ?? element.Marker ?? element.Span;
  if (span) {
    return serializeValue(span.contents ?? '');
  }
  return '';
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
