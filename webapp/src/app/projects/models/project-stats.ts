export interface ProjectStats {
  projectStats: {
    progress: number;
    translated: number;
    total: number;
    terms: number;
    locales: number;
  };
  localeStats: {
    [localeCode: string]: ProjectLocaleStats;
  };
}
export interface ProjectLocaleStats {
  progress: number;
  translated: number;
  total: number;
}
