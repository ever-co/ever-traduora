/**
 * A value for an XML attribute written by xml-js: & < and > become entities, as xml-js does for text but not for
 * attributes. A tab, line break or carriage return becomes a character reference (&#9; &#10; &#13;): written as it is,
 * a reader turns it into a space (attribute value normalization), and the term would no longer match. The double quote
 * is left to xml-js, which already writes it as &quot;, so nothing is escaped twice.
 */
export function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}
