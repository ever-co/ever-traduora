import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Plan } from './plan.entity';
import { NumberColumnType } from '../utils/database-type-helper';

@Entity()
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ length: 255, nullable: true })
  description: string;

  @Column(NumberColumnType.integer(0))
  termsCount: number;

  @Column(NumberColumnType.integer(0))
  localesCount: number;

  @ManyToOne(() => Plan, { onDelete: 'SET NULL', nullable: true })
  plan: Plan;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
