import { loadFixture, simpleFormatFixture } from './fixtures';
import { xliffExporter, xliffParser } from './xliff';

test('should parse xliff 1.2 files', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
    <xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
      <file source-language="en" datatype="plaintext" original="ng2.template">
        <body>
          <trans-unit id="53b0508c7030d534538b9417605a1fbf87a54e2b" datatype="html">
            <source>Current Plan: <x id="INTERPOLATION" equiv-text="{{ project.plan.name }}"/></source>
            <context-group purpose="location">
              <context context-type="sourcefile">app/projects/components/project-settings/project-settings.component.html</context>
              <context context-type="linenumber">43</context>
            </context-group>
          </trans-unit>
          <trans-unit id="1b5fc576e1d6d1432c897c27981481f8374ca6fd" datatype="html">
            <source>{VAR_PLURAL, plural, =0 {locales} =1 {locale} other {locales} }</source>
            <context-group purpose="location">
              <context context-type="sourcefile">app/projects/components/project-container/project-container.component.html</context>
              <context context-type="linenumber">13</context>
            </context-group>
            <context-group purpose="location">
              <context context-type="sourcefile">app/projects/components/project-card/project-card.component.html</context>
              <context context-type="linenumber">15</context>
            </context-group>
          </trans-unit>
          <trans-unit id="48eb80690ca85865a449cbf5e490a93ef01a9ca2" datatype="html">
            <source>Export format...</source>
            <context-group purpose="location">
              <context context-type="sourcefile">app/projects/components/export-locale/export-locale.component.html</context>
              <context context-type="linenumber">29</context>
            </context-group>
          </trans-unit>
        </body>
      </file>
    </xliff>
    `;

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result).toEqual({
    iso: 'en',
    translations: [
      {
        term: '53b0508c7030d534538b9417605a1fbf87a54e2b',
        translation: 'Current Plan: {{ project.plan.name }}',
      },
      {
        term: '1b5fc576e1d6d1432c897c27981481f8374ca6fd',
        translation: '{VAR_PLURAL, plural, =0 {locales} =1 {locale} other {locales} }',
      },
      {
        term: '48eb80690ca85865a449cbf5e490a93ef01a9ca2',
        translation: 'Export format...',
      },
    ],
  });
});

const xliffWithTarget = (body: string) => `<?xml version="1.0" encoding="UTF-8" ?>
    <xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
      <file source-language="en" target-language="de" datatype="plaintext" original="ng2.template">
        <body>
          ${body}
        </body>
      </file>
    </xliff>
    `;

test('should skip units without a target and import the others', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="translated" datatype="html">
            <source>Hello</source>
            <target>Hallo</target>
          </trans-unit>
          <trans-unit id="untranslated" datatype="html">
            <source>Goodbye</source>
          </trans-unit>
          <trans-unit id="also-translated" datatype="html">
            <source>Yes</source>
            <target>Ja</target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'translated', translation: 'Hallo' },
    { term: 'also-translated', translation: 'Ja' },
  ]);
});

test('should read a target that is a single placeholder', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="count" datatype="html">
            <source><x id="INTERPOLATION" equiv-text="{{ n }}"/></source>
            <target><x id="INTERPOLATION" equiv-text="{{ n }}"/></target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([{ term: 'count', translation: '{{ n }}' }]);
});

test('should keep numbered placeholders', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="two" datatype="html">
            <source><x id="INTERPOLATION" equiv-text="{{ a }}"/> and <x id="INTERPOLATION_1" equiv-text="{{ b }}"/></source>
            <target><x id="INTERPOLATION" equiv-text="{{ a }}"/> und <x id="INTERPOLATION_1" equiv-text="{{ b }}"/></target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([{ term: 'two', translation: '{{ a }} und {{ b }}' }]);
});

test('should keep the text inside g and mrk elements', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="link" datatype="html">
            <source>Click <g id="1">here</g> now</source>
            <target>Klicke <g id="1">hier</g> jetzt</target>
          </trans-unit>
          <trans-unit id="segment" datatype="html">
            <source><mrk mtype="seg" mid="0">Hello</mrk></source>
            <target><mrk mtype="seg" mid="0">Hallo</mrk></target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'link', translation: 'Klicke hier jetzt' },
    { term: 'segment', translation: 'Hallo' },
  ]);
});

test('should keep the text of ph elements and placeholders inside g and mrk elements', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="break" datatype="html">
            <source>Line<ph id="1">&lt;br/&gt;</ph>two</source>
            <target>Zeile<ph id="1">&lt;br/&gt;</ph>zwei</target>
          </trans-unit>
          <trans-unit id="greeting" datatype="html">
            <source>Hi <g id="1">dear <x id="INTERPOLATION" equiv-text="{{ name }}"/></g>!</source>
            <target>Hallo <g id="1">liebe <x id="INTERPOLATION" equiv-text="{{ name }}"/></g>!</target>
          </trans-unit>
          <trans-unit id="segment" datatype="html">
            <source><mrk mtype="seg" mid="0">Hello <x id="INTERPOLATION" equiv-text="{{ name }}"/></mrk></source>
            <target><mrk mtype="seg" mid="0">Hallo <x id="INTERPOLATION" equiv-text="{{ name }}"/></mrk></target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'break', translation: 'Zeile<br/>zwei' },
    { term: 'greeting', translation: 'Hallo liebe {{ name }}!' },
    { term: 'segment', translation: 'Hallo {{ name }}' },
  ]);
});

test('should import an explicitly empty target as an empty translation', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="cleared" datatype="html">
            <source>Hello</source>
            <target/>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([{ term: 'cleared', translation: '' }]);
});

test('should import units inside groups', async () => {
  const xml = xliffWithTarget(`
          <group id="menu">
            <trans-unit id="menu.open" datatype="html">
              <source>Open</source>
              <target>Öffnen</target>
            </trans-unit>
            <group id="menu.file">
              <trans-unit id="menu.file.save" datatype="html">
                <source>Save</source>
                <target>Speichern</target>
              </trans-unit>
            </group>
          </group>
          <trans-unit id="title" datatype="html">
            <source>Title</source>
            <target>Titel</target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'menu.open', translation: 'Öffnen' },
    { term: 'menu.file.save', translation: 'Speichern' },
    { term: 'title', translation: 'Titel' },
  ]);
});

test('should import units inside a group without attributes', async () => {
  const xml = xliffWithTarget(`
          <group>
            <trans-unit id="a" datatype="html">
              <source>Open</source>
              <target>Öffnen</target>
            </trans-unit>
          </group>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([{ term: 'a', translation: 'Öffnen' }]);
});

test('should import the units of every group without an id', async () => {
  const xml = xliffWithTarget(`
          <group resname="g1">
            <trans-unit id="a" datatype="html">
              <source>Open</source>
              <target>Öffnen</target>
            </trans-unit>
          </group>
          <group resname="g2">
            <trans-unit id="b" datatype="html">
              <source>Close</source>
              <target>Schließen</target>
            </trans-unit>
          </group>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'a', translation: 'Öffnen' },
    { term: 'b', translation: 'Schließen' },
  ]);
});

test('should import units inside nested groups without an id', async () => {
  const xml = xliffWithTarget(`
          <group resname="outer">
            <trans-unit id="a" datatype="html">
              <source>Open</source>
              <target>Öffnen</target>
            </trans-unit>
            <group>
              <group resname="inner">
                <trans-unit id="b" datatype="html">
                  <source>Close</source>
                  <target>Schließen</target>
                </trans-unit>
              </group>
            </group>
            <group resname="other">
              <trans-unit id="c" datatype="html">
                <source>Save</source>
                <target>Speichern</target>
              </trans-unit>
            </group>
          </group>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'a', translation: 'Öffnen' },
    { term: 'b', translation: 'Schließen' },
    { term: 'c', translation: 'Speichern' },
  ]);
});

test('should keep a space between two placeholders and between two mrk elements', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="placeholders" datatype="html">
            <source><x id="1" equiv-text="{a}"/> <x id="2" equiv-text="{b}"/></source>
            <target><x id="1" equiv-text="{a}"/> <x id="2" equiv-text="{b}"/></target>
          </trans-unit>
          <trans-unit id="segments" datatype="html">
            <source><mrk mtype="seg" mid="0">Hello</mrk> <mrk mtype="seg" mid="1">world</mrk></source>
            <target><mrk mtype="seg" mid="0">Hallo</mrk> <mrk mtype="seg" mid="1">Welt</mrk></target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'placeholders', translation: '{a} {b}' },
    { term: 'segments', translation: 'Hallo Welt' },
  ]);
});

test('should keep a space at the edge of a g element', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="placeholders" datatype="html">
            <source><g id="1"><x id="1" equiv-text="{a}"/> </g><x id="2" equiv-text="{b}"/></source>
            <target><g id="1"><x id="1" equiv-text="{a}"/> </g><x id="2" equiv-text="{b}"/></target>
          </trans-unit>
          <trans-unit id="words" datatype="html">
            <source>Hello<g id="1"> </g>world</source>
            <target>Hallo<g id="1"> </g>Welt</target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'placeholders', translation: '{a} {b}' },
    { term: 'words', translation: 'Hallo Welt' },
  ]);
});

test('should drop every whitespace-only part at the start and end of a value and keep the ones between', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="leading" datatype="html">
            <source><g id="1"> </g><g id="2"> </g><x id="1" equiv-text="{a}"/></source>
            <target><g id="1"> </g><g id="2"> </g><x id="1" equiv-text="{a}"/></target>
          </trans-unit>
          <trans-unit id="trailing" datatype="html">
            <source><x id="1" equiv-text="{a}"/><g id="1"> </g><g id="2"> </g></source>
            <target><x id="1" equiv-text="{a}"/><g id="1"> </g><g id="2"> </g></target>
          </trans-unit>
          <trans-unit id="both" datatype="html">
            <source><g id="1"> </g><g id="2"> </g><x id="1" equiv-text="{a}"/><g id="3"> </g><x id="2" equiv-text="{b}"/><g id="4"> </g><g id="5"> </g></source>
            <target><g id="1"> </g><g id="2"> </g><x id="1" equiv-text="{a}"/><g id="3"> </g><x id="2" equiv-text="{b}"/><g id="4"> </g><g id="5"> </g></target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'leading', translation: '{a}' },
    { term: 'trailing', translation: '{a}' },
    { term: 'both', translation: '{a} {b}' },
  ]);
});

test('should not add the line break between two placeholders on separate lines, in LF and CRLF files', async () => {
  const xml = xliffWithTarget(`
          <trans-unit id="crlf" datatype="html">
            <source>Hello</source>
            <target><x id="1" equiv-text="{a}"/>\r\n              <x id="2" equiv-text="{b}"/></target>
          </trans-unit>
          <trans-unit id="trailing-spaces" datatype="html">
            <source>Hello</source>
            <target><x id="1" equiv-text="{a}"/>  \n              <x id="2" equiv-text="{b}"/></target>
          </trans-unit>`);

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result.translations).toEqual([
    { term: 'crlf', translation: '{a}{b}' },
    { term: 'trailing-spaces', translation: '{a}{b}' },
  ]);
});

test('should import the units of every file element', async () => {
  const xml = `<?xml version="1.0" encoding="UTF-8" ?>
    <xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
      <file source-language="en" target-language="de" datatype="plaintext" original="messages">
        <body>
          <trans-unit id="a"><source>Open</source><target>Öffnen</target></trans-unit>
        </body>
      </file>
      <file source-language="en" target-language="de" datatype="plaintext" original="messages">
        <body>
          <trans-unit id="b"><source>Close</source><target>Schließen</target></trans-unit>
        </body>
      </file>
    </xliff>
    `;

  const result = await xliffParser({ version: '1.2' })(xml);
  expect(result).toEqual({
    iso: 'en',
    translations: [
      { term: 'a', translation: 'Öffnen' },
      { term: 'b', translation: 'Schließen' },
    ],
  });
});

test('should refuse a trans-unit without an id', async () => {
  const xml = xliffWithTarget(`
          <trans-unit datatype="html">
            <source>Open</source>
            <target>Öffnen</target>
          </trans-unit>`);

  await expect(xliffParser({ version: '1.2' })(xml)).rejects.toThrow();
});

test('should export xliff 1.2 files', async () => {
  const result = await xliffExporter({ version: '1.2' })({
    iso: 'de_DE',
    ...simpleFormatFixture,
  });
  const expected = loadFixture('simple.xliff');
  expect(result).toEqual(expected);
});

test('should keep "&amp;" in a translation exported as xliff 1.2', async () => {
  const translations = [
    { term: 'entity', translation: 'Use &amp; for an ampersand' },
    { term: 'double-entity', translation: 'a &amp;amp; b' },
    { term: 'ampersand', translation: 'Tom & Jerry' },
    { term: 'other-entity', translation: '&lt;b&gt;' },
  ];

  const result = (await xliffExporter({ version: '1.2' })({ iso: 'en', translations })) as string;

  expect(result).toContain('<source>Use &amp;amp; for an ampersand</source>');
  expect(result).toContain('<target>Use &amp;amp; for an ampersand</target>');
  expect(result).toContain('<target>a &amp;amp;amp; b</target>');
  expect(result).toContain('<target>Tom &amp; Jerry</target>');
  expect(result).toContain('<target>&amp;lt;b&amp;gt;</target>');
  expect(await xliffParser({ version: '1.2' })(result)).toEqual({ iso: 'en', translations });
});

test('should write a term with & < > and quotes as an escaped trans-unit id in xliff 1.2', async () => {
  const translations = [{ term: `a&b <c> "d" 'e'`, translation: 'x' }];

  const result = (await xliffExporter({ version: '1.2' })({ iso: 'en', translations })) as string;

  expect(result).toContain('<trans-unit id="a&amp;b &lt;c&gt; &quot;d&quot; &apos;e&apos;">');
  expect(await xliffParser({ version: '1.2' })(result)).toEqual({ iso: 'en', translations });
});
