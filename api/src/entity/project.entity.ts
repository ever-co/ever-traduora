import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Plan } from './plan.entity';

@Entity()
export class Project {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ length: 255, default: null })
  description: string;

  @Column({ default: 0 })
  termsCount: number;

  @Column({ default: 0 })
  localesCount: number;

  @ManyToOne(() => Plan, { onDelete: 'SET NULL' })
  plan: Plan;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
