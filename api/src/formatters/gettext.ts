import { po } from 'gettext-parser';
import { Exporter, IntermediateTranslationFormat, Parser } from '../domain/formatters';

const streamAsPromise = stream => {
  const result = [];

  stream.on('data', data => {
    result.push(data);
  });

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
  }).then(() => result);
};

export const gettextParser: Parser = async (data: string) => {
  const res = po.parse(data);

  const translations = [];
  for (const context of Object.keys(res.translations)) {
    const payload = res.translations[context];
    if (payload !== undefined) {
      for (const key of Object.keys(payload)) {
        if (key === '') {
          continue;
        }
        const item = payload[key];
        translations.push({ term: item.msgid, translation: item.msgstr.join('') });
      }
    }
  }

  return {
    translations,
  };
};

export const gettextExporter: Exporter = async (data: IntermediateTranslationFormat) => {
  const asObj = data.translations.reduce((acc, item) => ({ ...acc, [item.term]: { msgid: item.term, msgstr: item.translation } }), {});
  const out = {
    charset: 'utf-8',
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'Content-Transfer-Encoding': '8bit\n',
      'MIME-Version': '1.0\n',
    },
    translations: {
      '': asObj,
    },
  };
  if (data.iso) {
    // tslint:disable-next-line: no-string-literal
    out.headers['Language'] = `${data.iso}\n`;
  }
  const res = po.compile(out).toString();
  return res;
};
