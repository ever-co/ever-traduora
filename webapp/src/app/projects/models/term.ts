import { Label } from './label';

export interface Term {
  id: string;
  value: string;
  labels: Label[];
}
