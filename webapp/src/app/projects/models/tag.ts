export class Tag {
  id: string;
  value: string;
  color: string;
}

export interface TagColor {
  hex: string;
  displayName: string;
}

export const TAG_COLORS: TagColor[] = [{ hex: '#101010', displayName: 'Black' }, { hex: '#606060', displayName: 'Gray' }];
