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

test('should export xliff 1.2 files', async () => {
  const result = await xliffExporter({ version: '1.2' })({
    iso: 'de_DE',
    ...simpleFormatFixture,
  });
  const expected = loadFixture('simple.xliff');
  expect(result).toEqual(expected);
});
