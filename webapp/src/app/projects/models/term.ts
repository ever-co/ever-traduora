import { Tag } from './tag';

export interface Term {
  id: string;
  value: string;
  tags: Tag[];
}
