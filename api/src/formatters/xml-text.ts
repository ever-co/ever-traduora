/** A text for XML: every & becomes &amp;, also one that already starts an entity (the translation "&amp;"), and < and > become entities */
export function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The texts of a document written by xmlJs.js2xml, escaped by escapeXmlText instead of by xml-js: xml-js first turns
 * every "&amp;" in a text back into "&" and then escapes it, so it writes the translation "&amp;" as "&amp;", which
 * reads back as "&".
 *
 * Every text in the document is given to xml-js as `text(value)`: a number, which xml-js writes as it is, and the
 * `textFn` passed to js2xml writes the escaped text for it. An empty text stays empty, so an empty value is still
 * written as it was (<value/>). A text not given through `text` fails the export instead of being written wrong.
 */
export function xmlTexts() {
  const texts = new Map<string, string>();
  return {
    text: (value: string): string => {
      if (value === '') {
        return '';
      }
      const placeholder = String(texts.size);
      texts.set(placeholder, value);
      return placeholder;
    },
    textFn: (placeholder: string): string => {
      if (placeholder === '') {
        return '';
      }
      if (!texts.has(placeholder)) {
        throw new Error(`XML text not given through text(): ${placeholder}`);
      }
      return escapeXmlText(texts.get(placeholder));
    },
  };
}
