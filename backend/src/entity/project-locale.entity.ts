import { Column, Entity, Index, ManyToOne, PrimaryGeneratedColumn, OneToMany } from 'typeorm';
import { AccessTimestamps } from './base';
import { Locale } from './locale.entity';
import { Project } from './project.entity';
import { Translation } from './translation.entity';

@Entity()
@Index(['project', 'locale'], { unique: true })
export class ProjectLocale {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Locale, { onDelete: 'CASCADE' })
  locale: Locale;

  @ManyToOne(() => Project, { onDelete: 'CASCADE' })
  project: Project;

  @OneToMany(() => Translation, translation => translation.projectLocale)
  translations: Translation[];

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
