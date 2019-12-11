import { Label } from './label';

export interface Translation {
  termId: string;
  value: string;
  labels: Label[];
}
