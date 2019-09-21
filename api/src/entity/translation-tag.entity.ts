import { Column, Entity, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Tag } from './tag.entity';
import { Translation } from './translation.entity';

@Entity()
export class TranslationTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Translation, { onDelete: 'CASCADE', nullable: false })
  translation: Translation;

  @ManyToOne(() => Tag, { onDelete: 'CASCADE', nullable: false })
  tag: Tag;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
