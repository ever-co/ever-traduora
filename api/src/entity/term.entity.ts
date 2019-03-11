import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Project } from './project.entity';
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

  @OneToMany(() => Translation, translation => translation.term)
  @JoinColumn()
  translations: Translation[];

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
