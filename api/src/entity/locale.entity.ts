import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AccessTimestamps } from './base';

@Entity()
export class Locale {
  @PrimaryColumn({ length: 255 })
  code: string;

  @Column({ length: 255 })
  language: string;

  @Column({ length: 255 })
  region: string;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
