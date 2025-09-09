import { Label } from './label';

export interface Term {
  id: string;
  value: string;
  context: string | null;
  labels: Label[];
}
