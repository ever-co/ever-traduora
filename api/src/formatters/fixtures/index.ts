import * as fs from 'fs';
import { IntermediateTranslationFormat } from '../../domain/formatters';

export const loadFixture = (name: string) => {
  return fs.readFileSync(`src/formatters/fixtures/${name}`, { encoding: 'utf-8' });
};

export const simpleFormatFixture: IntermediateTranslationFormat = {
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

export const riskyPayloads: IntermediateTranslationFormat = {
  translations: [
    {
      term: `=cmd|' /C calc'!A0`,
      translation: 'to open the calculator application on the target machine (calculator automatic open command)',
    },
    {
      term: `=HYPERLINK('https://www.google.com', 'Google')`,
      translation: 'hyperlink function in excel',
    },
    {
      term: `=cmd|' /C notepad'!'A1'`,
      translation: 'to open the notepad application on excel/csv on the target machine (notepad automatic open command)'
    }
  ],
};
