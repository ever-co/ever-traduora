import { Locale } from './locale';

export interface ProjectLocale {
  id: string;
  locale: Locale;
  stats: {
    progress: number;
    translated: number;
    total: number;
  };
}
