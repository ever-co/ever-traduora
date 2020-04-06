import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, ManyToMany } from 'typeorm';
import { AccessTimestamps } from './base';
import { ProjectLocale } from './project-locale.entity';
import { Term } from './term.entity';
import { Label } from './label.entity';

@Entity()
export class Translation {
  @PrimaryColumn()
  termId: string;

  @PrimaryColumn()
  projectLocaleId: string;

  @Column({ type: 'text' })
  value: string;

  @ManyToOne(
    type => Term,
    term => term.translations,
    { onDelete: 'CASCADE', nullable: false },
  )
  @JoinColumn()
  term: Term;

  @ManyToOne(type => ProjectLocale, { onDelete: 'CASCADE', nullable: false })
  projectLocale: ProjectLocale;

  @ManyToMany(
    () => Label,
    label => label.translations,
  )
  labels: Label[];

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
