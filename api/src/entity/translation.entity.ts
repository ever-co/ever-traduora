import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, ManyToMany } from 'typeorm';
import { AccessTimestamps } from './base';
import { ProjectLocale } from './project-locale.entity';
import { Term } from './term.entity';
import { Tag } from './tag.entity';

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

  @ManyToMany(() => Tag, tag => tag.translations)
  tags: Tag[];

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
