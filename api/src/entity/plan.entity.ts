import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AccessTimestamps } from './base';

@Entity()
export class Plan {
  @PrimaryColumn('varchar')
  code: string;

  @Column()
  name: string;

  @Column()
  maxStrings: number;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
