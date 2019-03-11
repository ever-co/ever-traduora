import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';

import { AccessTimestamps } from './base';
import { Locale } from './locale.entity';
import { Project } from './project.entity';

@Entity()
@Index(['project', 'locale'], { unique: true })
export class ProjectLocale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Locale, { onDelete: 'CASCADE' })
  locale: Locale;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
