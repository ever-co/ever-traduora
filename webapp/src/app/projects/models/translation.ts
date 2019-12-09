import { Tag } from './tag';

export interface Translation {
  termId: string;
  value: string;
  tags: Tag[];
}
