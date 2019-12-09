import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { ProjectLocale } from './project-locale.entity';
import { Term } from './term.entity';

@Entity()
export class Translation {
  @PrimaryColumn()
  termId: string;

  @PrimaryColumn()
  projectLocaleId: string;

  @Column({ type: 'text' })
  value: string;

  @ManyToOne(type => Term, term => term.translations, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn()
  term: Term;

  @ManyToOne(type => ProjectLocale, { onDelete: 'CASCADE', nullable: false })
  projectLocale: ProjectLocale;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
