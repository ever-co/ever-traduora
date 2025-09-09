import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, ManyToMany, JoinTable } from 'typeorm';
import { Project } from './project.entity';
import { Term } from './term.entity';
import { Translation } from './translation.entity';

@Entity()
@Index(['project', 'value'], { unique: true })
export class Label {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 255 })
  value: string;

  @Column({ length: 8 })
  color: string;

  @ManyToOne(() => Project, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  project: Project;

  @ManyToMany(() => Term, term => term.labels, { cascade: true })
  @JoinTable()
  terms: Term[];

  @ManyToMany(() => Translation, translation => translation.labels, { cascade: true })
  @JoinTable()
  translations: Translation[];
}
