import { createxliff12, xliff12ToJs } from 'xliff';
import { Exporter, IntermediateTranslation, IntermediateTranslationFormat, Parser } from '../domain/formatters';

export const xliffParser: (options: { version: string }) => Parser = options => async (data: string) => {
  const xml = await parseFromVersion(options.version, data);

  const sourceOrTarget = xml.targetLanguage ? 'target' : 'source';
  const result: IntermediateTranslation[] = [];

  const resources = xml.resources;
  for (const resourceName of Object.keys(resources)) {
    const resource = resources[resourceName];

    for (const transUnitId of Object.keys(resource)) {
      const transUnit = resource[transUnitId];
      const items = transUnit[sourceOrTarget];
      const translation = typeof items === 'string' ? items : items.map(serializeElement).join('');
      result.push({
        term: transUnitId,
        translation,
      });
    }
  }

  return {
    iso: xml.sourceLanguage,
    translations: result,
  };
};

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

function serializeElement(element: any): string {
  if (typeof element === 'object') {
    if (element.Standalone && element.Standalone.id === 'INTERPOLATION') return element.Standalone['equiv-text'];
    else return '';
  }
  return element;
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
