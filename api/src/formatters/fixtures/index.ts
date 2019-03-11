import * as fs from 'fs';

export const loadFixture = (name: string) => {
  return fs.readFileSync(`src/formatters/fixtures/${name}`, { encoding: 'utf-8' });
};

export const simpleFormatFixture = {
  translations: [
    {
      term: 'term.one',
      translation: 'Current Plan: {{ project.plan.name }}',
    },
    {
      term: 'term two',
      translation: '{VAR_PLURAL, plural, =0 {locales} =1 {locale} other {locales} }',
    },
    {
      term: 'TERM_THREE',
      translation: 'Export format...',
    },
    {
      term: 'term:four',
      translation: `hello there you\\nthis should be in a newline`,
    },
  ],
};
