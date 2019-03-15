import { IMPORT_FORMATS } from './import';

export interface ExportFormat {
  displayName: string;
  code: string;
  extension: string;
}

// Currently on-par with import formats
export const EXPORT_FORMATS: ExportFormat[] = IMPORT_FORMATS;
