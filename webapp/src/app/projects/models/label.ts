export class Label {
  id: string;
  value: string;
  color: string;
}

export interface LabelColor {
  hex: string;
  displayName: string;
  textMode: string;
}

export const TAG_COLORS: string[] = [
  '#304D6D',
  '#A7CCED',
  '#008C45',
  '#63ADF2',
  '#82A0BC',
  '#D81159',
  '#FCCA46',
  '#4AAC5F',
  '#404E7C',
  '#7D1128',
  '#C41E3D',
  '#ED254E',
  '#FFD275',
  '#3AB795',
  '#F2CC46',
  '#F58549',
  '#FF5E5B',
  '#EF798A',
  '#F7A9A8',
  '#36413E',
  '#87BCDE',
  '#6B8F71',
  '#F7C1BB',
  '#EC4067',
];
