import { Column, Entity, PrimaryColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { NumberColumnType } from '../utils/database-type-helper';

@Entity()
export class Plan {
  @PrimaryColumn('varchar')
  code: string;

  @Column()
  name: string;

  @Column(NumberColumnType.integer(0))
  maxStrings: number;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
