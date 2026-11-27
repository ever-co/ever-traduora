/**
 * A value for an XML attribute written by xml-js: & < and > become entities, as xml-js does for text but not for
 * attributes. The double quote is left to xml-js, which already writes it as &quot;, so nothing is escaped twice.
 */
export function escapeXmlAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
