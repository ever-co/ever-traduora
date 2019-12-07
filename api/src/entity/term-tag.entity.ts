import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { AccessTimestamps } from './base';
import { Tag } from './tag.entity';
import { Term } from './term.entity';

@Entity()
export class TermTag {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => Term, { onDelete: 'CASCADE', nullable: false })
  term: Term;

  @ManyToOne(() => Tag, { onDelete: 'CASCADE', nullable: false })
  tag: Tag;

  @Column(type => AccessTimestamps)
  date: AccessTimestamps;
}
