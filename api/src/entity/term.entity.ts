import { Column, Entity, Index, JoinColumn, ManyToMany, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Project } from './project.entity';
import { Label } from './label.entity';
import { Translation } from './translation.entity';

@Entity()
@Index(['project', 'value'], { unique: true })
export class Term {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  value: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  project: Project;

  @OneToMany(
    () => Translation,
    translation => translation.term,
  )
  @JoinColumn()
  translations: Translation[];

  @ManyToMany(
    () => Label,
    label => label.terms,
  )
  labels: Label[];

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
