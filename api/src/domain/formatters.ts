export interface IntermediateTranslationFormat {
  iso?: string;
  translations: IntermediateTranslation[];
}

export type Parser = (payload: string) => Promise<IntermediateTranslationFormat>;

export type Exporter = (data: IntermediateTranslationFormat) => Promise<string>;

export interface IntermediateTranslation {
  term: string;
  translation: string;
}
